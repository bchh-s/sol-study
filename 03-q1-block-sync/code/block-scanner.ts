/**
 * Solana Block Scanner PoC
 *
 * Dagaon Core 입금 파이프라인의 핵심 로직을 TypeScript로 구현한 PoC.
 * 실제 Dagaon Core는 Go로 구현되지만, 개념 검증과 학습을 위해 TS로 작성.
 *
 * 매핑:
 *   이 코드                      Dagaon Core 컴포넌트
 *   ─────────────────────────    ──────────────────────
 *   getFinalized Slot()          Block Publisher - getCurrentBlock()
 *   scanSlotRange()              Block Publisher - 슬롯 스캐닝 루프
 *   fetchBlock()                 Block Publisher - getBlock() 호출
 *   extractNativeTransfers()     Block Consumer  - SOL transfer 추출
 *   extractSplTokenTransfers()   Block Consumer  - SPL token transfer 추출
 *   filterFailedTransactions()   Block Consumer  - meta.err 필터링
 *
 * 실행 방법:
 *   cd 03-q1-block-sync/code
 *   npm install
 *   npx ts-node block-scanner.ts
 *
 * 또는 상위 examples의 node_modules를 공유:
 *   npx ts-node block-scanner.ts
 */

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  BlockResponse,
  VersionedBlockResponse,
  TransactionResponse,
  ConfirmedTransactionMeta,
} from "@solana/web3.js";

// ============================================================================
// 설정
// ============================================================================

/**
 * Solana devnet 연결 (finalized commitment)
 *
 * Dagaon Core에서는:
 *   - Block Publisher가 "finalized" commitment으로 블록을 조회
 *   - finalized = 31+ 후속 투표 완료, reorg 불가능
 *   - EVM의 "64 confirmations" 대기와 유사하지만, ~13초면 완료
 */
const RPC_URL = "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "finalized");

/**
 * 스캔할 슬롯 범위
 *
 * Dagaon Core에서는:
 *   - BATCH_SIZE = etcd checkpoint 이후 ~ 현재 finalized slot
 *   - 정상 운영: 50~100 슬롯 (400ms * 100 = 40초 분량)
 *   - catch-up 모드: 500 슬롯
 */
const SCAN_RANGE = 30;

/**
 * 의미 있는 transfer 최소 금액 (lamports)
 * 너무 작은 금액(rent deposit 등)을 필터링
 */
const MIN_TRANSFER_LAMPORTS = 1000;

// ============================================================================
// 타입 정의 (Dagaon Core의 DTO에 대응)
// ============================================================================

/**
 * Native SOL Transfer
 *
 * Dagaon Core DB: solana_transfers 테이블 (transfer_type = 1)
 * EVM 대응: tx.value > 0 또는 internal transaction trace
 */
interface NativeTransfer {
  txSignature: string;       // TX 고유 식별자 (EVM의 tx_hash 대응)
  slot: number;              // 슬롯 번호 (EVM의 block_number 대응)
  from: string;              // 송신자 주소 (base58)
  to: string;                // 수신자 주소 (base58)
  amount: number;            // lamports (1 SOL = 1,000,000,000 lamports)
  amountSol: string;         // 사람이 읽기 쉬운 SOL 단위
  instructionIndex: number;  // instruction 인덱스 (고유 식별자의 일부)
}

/**
 * SPL Token Transfer
 *
 * Dagaon Core DB: solana_transfers 테이블 (transfer_type = 2)
 * EVM 대응: Transfer(address,address,uint256) event log
 */
interface SplTokenTransfer {
  txSignature: string;
  slot: number;
  mint: string;              // 토큰 민트 주소 (EVM의 contract_address 대응)
  from: string;              // 송신자 owner 주소
  to: string;                // 수신자 owner 주소
  amount: string;            // raw amount (decimals 적용 전)
  decimals: number;
  uiAmount: number;          // 사람이 읽기 쉬운 단위
  accountIndex: number;      // 계정 인덱스 (고유 식별자의 일부)
}

/**
 * 블록 스캔 결과 요약
 *
 * Dagaon Core에서는 이 데이터가 Kafka 메시지로 발행됨
 */
interface BlockScanResult {
  slot: number;
  blockHeight: number | null;
  blockhash: string;
  previousBlockhash: string;
  parentSlot: number;
  blockTime: number | null;
  totalTransactions: number;
  successTransactions: number;
  failedTransactions: number;
  nativeTransfers: NativeTransfer[];
  splTokenTransfers: SplTokenTransfer[];
}

// ============================================================================
// Step 1: 현재 Finalized 슬롯 조회
// ============================================================================

/**
 * 현재 finalized 슬롯 번호를 가져온다.
 *
 * Dagaon Core 대응: Block Publisher의 getCurrentBlock()
 *
 * EVM에서는:
 *   eth_blockNumber → 최신 블록 번호 (아직 미확정!)
 *   → Event Confirmer가 N블록 대기 후 확정
 *
 * Solana에서는:
 *   getSlot("finalized") → 이미 확정된 최신 슬롯 번호
 *   → Event Confirmer 불필요!
 */
async function getFinalizedSlot(): Promise<number> {
  console.log("=== Step 1: 현재 Finalized 슬롯 조회 ===");
  console.log("  Dagaon Core 대응: Block Publisher.getCurrentBlock()");
  console.log("  EVM 대응: eth_blockNumber (단, Solana는 이미 finalized)\n");

  const slot = await connection.getSlot("finalized");
  const blockHeight = await connection.getBlockHeight("finalized");

  console.log(`  현재 finalized slot:    ${slot}`);
  console.log(`  현재 finalized height:  ${blockHeight}`);
  console.log(`  slot - height 차이:     ${slot - blockHeight} (빈 슬롯 누적)`);
  console.log(`  ※ slot_number != block_height (빈 슬롯이 있으므로)\n`);

  return slot;
}

// ============================================================================
// Step 2: 유효 슬롯 목록 조회 (getBlocks)
// ============================================================================

/**
 * 범위 내 실제 블록이 있는 슬롯 목록을 가져온다.
 *
 * Dagaon Core 대응: Block Publisher의 fetchBlockRange()
 *
 * EVM에서는:
 *   for n = lastProcessed+1; getBlockByNumber(n); n++
 *   → 모든 번호에 블록이 있으므로 단순 순차 증가
 *
 * Solana에서는:
 *   getBlocks(start, end, "finalized")
 *   → 빈 슬롯(리더 오프라인, 포크 폐기 등)이 자동으로 제외됨
 *   → 반환된 슬롯만 getBlock()으로 조회하면 됨
 */
async function scanSlotRange(
  startSlot: number,
  endSlot: number
): Promise<number[]> {
  console.log("=== Step 2: 유효 슬롯 목록 조회 (getBlocks) ===");
  console.log("  Dagaon Core 대응: Block Publisher.fetchBlockRange()");
  console.log("  EVM 대응: 필요 없음 (모든 blockNumber에 블록 존재)\n");

  const totalSlots = endSlot - startSlot + 1;
  const confirmedSlots = await connection.getBlocks(
    startSlot,
    endSlot,
    "finalized"
  );

  const emptySlots = totalSlots - confirmedSlots.length;
  const emptyRatio = ((emptySlots / totalSlots) * 100).toFixed(1);

  console.log(`  스캔 범위:     ${startSlot} ~ ${endSlot}`);
  console.log(`  전체 슬롯:     ${totalSlots}개`);
  console.log(`  유효 블록:     ${confirmedSlots.length}개`);
  console.log(`  빈 슬롯:       ${emptySlots}개 (${emptyRatio}%)`);
  console.log(
    `  유효 슬롯:     [${confirmedSlots.slice(0, 5).join(", ")}${confirmedSlots.length > 5 ? ", ..." : ""}]`
  );
  console.log(
    `  ※ Mainnet 평균 빈 슬롯 비율: ~5%\n`
  );

  return confirmedSlots;
}

// ============================================================================
// Step 3: 블록 데이터 조회 (getBlock)
// ============================================================================

/**
 * 단일 슬롯의 블록 전체 데이터를 가져온다.
 *
 * Dagaon Core 대응: Block Publisher.fetchBlock(slot)
 *
 * EVM에서는:
 *   eth_getBlockByNumber(n, true) → 단일 블록 + 전체 TX
 *
 * Solana에서는:
 *   getBlock(slot, options) → 단일 블록 + 전체 TX + meta(balances)
 *
 * getBlock 옵션:
 *   - maxSupportedTransactionVersion: 0 → v0 TX(Address Lookup Table) 지원
 *   - transactionDetails: "full" → 전체 TX 데이터 포함
 *   - commitment: "finalized" → 확정된 블록만
 *   - rewards: false → validator reward 불필요 (Dagaon Core 용도 아님)
 */
async function fetchBlock(
  slot: number
): Promise<VersionedBlockResponse | null> {
  try {
    const block = await connection.getBlock(slot, {
      maxSupportedTransactionVersion: 0,
      transactionDetails: "full",
      commitment: "finalized",
      rewards: false,
    });
    return block;
  } catch (err: any) {
    // getBlock이 실패하는 경우:
    // - 빈 슬롯 (getBlocks에서 필터링했으므로 드묾)
    // - RPC 일시 오류 → 재시도
    // - Rate limit → 백오프
    if (err.message?.includes("was skipped") || err.message?.includes("missing")) {
      console.log(`  [WARN] 슬롯 ${slot}은 빈 슬롯 (스킵)`);
      return null;
    }
    throw err;
  }
}

// ============================================================================
// Step 4: Native SOL Transfer 추출
// ============================================================================

/**
 * 블록 내 TX에서 Native SOL transfer를 추출한다.
 *
 * Dagaon Core 대응: Block Consumer.extractNativeTransfers()
 *
 * EVM에서는:
 *   1. tx.value > 0 → native ETH 전송
 *   2. trace_call → internal transactions (컨트랙트 내부 ETH 이동)
 *
 * Solana에서는:
 *   preBalances vs postBalances 배열 비교
 *   - 배열 인덱스 = accountKeys 인덱스
 *   - diff > 0이면 수신, diff < 0이면 송신
 *   - fee payer(index 0)의 diff에는 fee가 포함되어 있으므로 주의
 *
 * CRITICAL: meta.err !== null 인 TX는 반드시 건너뛰어야 함!
 *   EVM에서는 실패 TX에 Transfer event log가 없으므로 자연스럽게 필터링됨.
 *   Solana에서는 실패 TX도 블록에 포함되며 balance 변화(fee 차감)가 있음.
 */
function extractNativeTransfers(
  tx: VersionedBlockResponse["transactions"][0],
  slot: number
): NativeTransfer[] {
  const transfers: NativeTransfer[] = [];
  const meta = tx.meta;
  if (!meta) return transfers;

  // =====================================================
  // CRITICAL: 실패 TX 필터링
  // meta.err !== null이면 TX가 실패한 것
  // 실패 TX의 balance 변화는 fee 차감뿐이므로 transfer가 아님
  // 이 체크를 빠뜨리면 존재하지 않는 입금을 인식하는 버그 발생!
  // =====================================================
  if (meta.err !== null) {
    return transfers;
  }

  const accountKeys = tx.transaction.message.staticAccountKeys;
  const fee = meta.fee;

  // 모든 계정의 잔액 변화를 계산
  for (let i = 0; i < accountKeys.length; i++) {
    const pre = meta.preBalances[i];
    const post = meta.postBalances[i];
    const diff = post - pre;

    // 수신 감지: 잔액이 증가한 계정 (최소 금액 이상)
    if (diff > 0 && diff >= MIN_TRANSFER_LAMPORTS) {
      // sender 찾기: 잔액이 감소한 계정
      // fee payer(보통 index 0)는 diff = -(transfer + fee) 이므로
      // 수신자의 diff와 정확히 대응하는 sender를 찾아야 함
      let senderAddress = "unknown";

      for (let j = 0; j < accountKeys.length; j++) {
        if (j === i) continue;
        const senderDiff = meta.postBalances[j] - meta.preBalances[j];
        // sender의 diff: -(transfer_amount) 또는 -(transfer_amount + fee)
        // fee payer가 sender인 경우: senderDiff = -(diff + fee)
        // fee payer가 아닌 sender인 경우: senderDiff = -diff
        if (senderDiff === -diff || senderDiff === -(diff + fee)) {
          senderAddress = accountKeys[j].toBase58();
          break;
        }
      }

      // sender를 못 찾았으면 fee payer를 기본값으로 사용
      // (여러 transfer가 번들된 TX에서는 정확한 매핑이 어려울 수 있음)
      if (senderAddress === "unknown" && accountKeys.length > 0) {
        // fee payer는 보통 첫 번째 계정
        const feePayerDiff = meta.postBalances[0] - meta.preBalances[0];
        if (feePayerDiff < 0) {
          senderAddress = accountKeys[0].toBase58();
        }
      }

      transfers.push({
        txSignature: tx.transaction.signatures[0],
        slot,
        from: senderAddress,
        to: accountKeys[i].toBase58(),
        amount: diff,
        amountSol: (diff / LAMPORTS_PER_SOL).toFixed(9),
        instructionIndex: 0, // balance diff 기반이므로 정확한 instruction index는 별도 파싱 필요
      });
    }
  }

  return transfers;
}

// ============================================================================
// Step 5: SPL Token Transfer 추출
// ============================================================================

/**
 * 블록 내 TX에서 SPL Token transfer를 추출한다.
 *
 * Dagaon Core 대응: Block Consumer.extractSplTokenTransfers()
 *
 * EVM에서는:
 *   receipt.logs → topic[0] == Transfer 시그니처?
 *   → from = topic[1], to = topic[2], amount = data
 *   → contract_address = log.address (토큰 컨트랙트)
 *
 * Solana에서는:
 *   preTokenBalances vs postTokenBalances 비교
 *   - 각 항목에 mint(토큰 주소), owner(지갑 주소), amount가 포함
 *   - accountIndex로 pre/post를 매칭
 *   - diff > 0이면 토큰 수신
 *
 * 주의:
 *   - owner = 실제 지갑 주소 (Dagaon Core의 감시 지갑과 매칭)
 *   - accountIndex의 주소 = ATA 주소 (Token Account 주소, 지갑 주소 아님!)
 *   - EVM의 "from" 주소가 아닌 "owner" 주소를 사용해야 함
 */
function extractSplTokenTransfers(
  tx: VersionedBlockResponse["transactions"][0],
  slot: number
): SplTokenTransfer[] {
  const transfers: SplTokenTransfer[] = [];
  const meta = tx.meta;
  if (!meta) return transfers;

  // CRITICAL: 실패 TX 필터링 (위와 동일한 이유)
  if (meta.err !== null) {
    return transfers;
  }

  const preTokenBalances = meta.preTokenBalances ?? [];
  const postTokenBalances = meta.postTokenBalances ?? [];

  // postTokenBalances를 기준으로 잔액 변화 감지
  for (const post of postTokenBalances) {
    // 동일 accountIndex의 pre 값 찾기
    const pre = preTokenBalances.find(
      (p) => p.accountIndex === post.accountIndex
    );

    const preAmount = pre ? BigInt(pre.uiTokenAmount.amount) : 0n;
    const postAmount = BigInt(post.uiTokenAmount.amount);
    const diff = postAmount - preAmount;

    if (diff > 0n) {
      // 토큰 수신 감지!
      // sender 찾기: 같은 mint에서 잔액이 감소한 다른 계정
      let senderOwner = "unknown";
      for (const otherPost of postTokenBalances) {
        if (otherPost.accountIndex === post.accountIndex) continue;
        if (otherPost.mint !== post.mint) continue;

        const otherPre = preTokenBalances.find(
          (p) => p.accountIndex === otherPost.accountIndex
        );
        if (!otherPre) continue;

        const otherPreAmt = BigInt(otherPre.uiTokenAmount.amount);
        const otherPostAmt = BigInt(otherPost.uiTokenAmount.amount);
        if (otherPostAmt < otherPreAmt) {
          senderOwner = otherPre.owner ?? "unknown";
          break;
        }
      }

      // pre에만 있고 post에 없는 계정도 sender 후보 (계정 close 케이스)
      if (senderOwner === "unknown") {
        for (const preEntry of preTokenBalances) {
          if (preEntry.mint !== post.mint) continue;
          const matchPost = postTokenBalances.find(
            (p) => p.accountIndex === preEntry.accountIndex
          );
          if (!matchPost && BigInt(preEntry.uiTokenAmount.amount) > 0n) {
            senderOwner = preEntry.owner ?? "unknown";
            break;
          }
        }
      }

      transfers.push({
        txSignature: tx.transaction.signatures[0],
        slot,
        mint: post.mint,
        from: senderOwner,
        to: post.owner ?? "unknown",
        amount: diff.toString(),
        decimals: post.uiTokenAmount.decimals,
        uiAmount: Number(diff) / 10 ** post.uiTokenAmount.decimals,
        accountIndex: post.accountIndex,
      });
    }
  }

  // Edge Case: preTokenBalances에만 있고 postTokenBalances에 없는 경우
  // → 토큰 계정이 close됨 (전액이 다른 계정으로 전송됨)
  for (const pre of preTokenBalances) {
    const postExists = postTokenBalances.find(
      (p) => p.accountIndex === pre.accountIndex
    );

    if (!postExists && BigInt(pre.uiTokenAmount.amount) > 0n) {
      // 이 계정의 전체 잔액이 다른 곳으로 이동
      // 수신자: 같은 mint의 postTokenBalances에서 잔액이 증가한 계정
      // (위 로직에서 이미 처리되었을 수 있으므로 중복 체크 필요)
      const alreadyCovered = transfers.some(
        (t) => t.mint === pre.mint && t.txSignature === tx.transaction.signatures[0]
      );

      if (!alreadyCovered) {
        // 수신자를 postTokenBalances에서 찾기
        const receiver = postTokenBalances.find((p) => {
          if (p.mint !== pre.mint) return false;
          const matchPre = preTokenBalances.find(
            (pp) => pp.accountIndex === p.accountIndex
          );
          const preAmt = matchPre ? BigInt(matchPre.uiTokenAmount.amount) : 0n;
          const postAmt = BigInt(p.uiTokenAmount.amount);
          return postAmt > preAmt;
        });

        if (receiver) {
          const receiverPre = preTokenBalances.find(
            (p) => p.accountIndex === receiver.accountIndex
          );
          const receiverPreAmt = receiverPre
            ? BigInt(receiverPre.uiTokenAmount.amount)
            : 0n;
          const receiverPostAmt = BigInt(receiver.uiTokenAmount.amount);
          const diff = receiverPostAmt - receiverPreAmt;

          transfers.push({
            txSignature: tx.transaction.signatures[0],
            slot,
            mint: pre.mint,
            from: pre.owner ?? "unknown",
            to: receiver.owner ?? "unknown",
            amount: diff.toString(),
            decimals: pre.uiTokenAmount.decimals,
            uiAmount: Number(diff) / 10 ** pre.uiTokenAmount.decimals,
            accountIndex: receiver.accountIndex,
          });
        }
      }
    }
  }

  return transfers;
}

// ============================================================================
// Step 6: 전체 블록 스캔 실행
// ============================================================================

/**
 * 단일 블록을 스캔하고 transfer를 추출한다.
 *
 * Dagaon Core에서는:
 *   Block Publisher가 블록을 Kafka에 발행하고,
 *   Block Consumer가 Kafka에서 소비하여 transfer를 추출하고 DB에 저장한다.
 *
 * 이 PoC에서는 두 컴포넌트의 역할을 하나로 합쳐서 실행한다.
 */
async function processBlock(slot: number): Promise<BlockScanResult | null> {
  const block = await fetchBlock(slot);
  if (!block) return null;

  const allNativeTransfers: NativeTransfer[] = [];
  const allSplTokenTransfers: SplTokenTransfer[] = [];
  let successCount = 0;
  let failedCount = 0;

  for (const tx of block.transactions) {
    // meta.err 체크로 성공/실패 분류
    if (tx.meta?.err !== null) {
      failedCount++;
      continue; // 실패 TX는 transfer 추출 건너뜀
    }
    successCount++;

    // Native SOL transfer 추출
    const nativeTransfers = extractNativeTransfers(tx, slot);
    allNativeTransfers.push(...nativeTransfers);

    // SPL Token transfer 추출
    const splTransfers = extractSplTokenTransfers(tx, slot);
    allSplTokenTransfers.push(...splTransfers);
  }

  return {
    slot,
    blockHeight: (block as any).blockHeight ?? null,
    blockhash: block.blockhash,
    previousBlockhash: block.previousBlockhash,
    parentSlot: block.parentSlot,
    blockTime: block.blockTime,
    totalTransactions: block.transactions.length,
    successTransactions: successCount,
    failedTransactions: failedCount,
    nativeTransfers: allNativeTransfers,
    splTokenTransfers: allSplTokenTransfers,
  };
}

// ============================================================================
// Step 7: 결과 출력 (Dagaon Core에서는 Kafka 발행 + DB 저장)
// ============================================================================

function printBlockResult(result: BlockScanResult): void {
  const time = result.blockTime
    ? new Date(result.blockTime * 1000).toISOString()
    : "N/A";

  console.log(`  ┌─ Slot ${result.slot} (height: ${result.blockHeight})`);
  console.log(`  │  blockhash:         ${result.blockhash.slice(0, 20)}...`);
  console.log(`  │  previousBlockhash: ${result.previousBlockhash.slice(0, 20)}...`);
  console.log(`  │  parentSlot:        ${result.parentSlot}`);
  console.log(`  │  blockTime:         ${time}`);
  console.log(`  │  TX 총:             ${result.totalTransactions}건`);
  console.log(`  │  TX 성공:           ${result.successTransactions}건`);
  console.log(
    `  │  TX 실패:           ${result.failedTransactions}건 (meta.err != null, 추출 제외)`
  );
  console.log(`  │  SOL transfers:     ${result.nativeTransfers.length}건`);
  console.log(`  │  SPL transfers:     ${result.splTokenTransfers.length}건`);

  // Native SOL transfers 출력 (최대 3건)
  for (const t of result.nativeTransfers.slice(0, 3)) {
    console.log(`  │  ├─ [SOL] ${t.amountSol} SOL`);
    console.log(`  │  │  from: ${t.from.slice(0, 20)}...`);
    console.log(`  │  │  to:   ${t.to.slice(0, 20)}...`);
    console.log(`  │  │  sig:  ${t.txSignature.slice(0, 20)}...`);
  }
  if (result.nativeTransfers.length > 3) {
    console.log(
      `  │  └─ ... +${result.nativeTransfers.length - 3}건 더`
    );
  }

  // SPL Token transfers 출력 (최대 3건)
  for (const t of result.splTokenTransfers.slice(0, 3)) {
    console.log(`  │  ├─ [SPL] ${t.uiAmount} tokens (${t.decimals} decimals)`);
    console.log(`  │  │  mint: ${t.mint.slice(0, 20)}...`);
    console.log(`  │  │  from: ${t.from.slice(0, 20)}...`);
    console.log(`  │  │  to:   ${t.to.slice(0, 20)}...`);
  }
  if (result.splTokenTransfers.length > 3) {
    console.log(
      `  │  └─ ... +${result.splTokenTransfers.length - 3}건 더`
    );
  }

  console.log(`  └─`);
}

// ============================================================================
// Step 8: previousBlockhash 연속성 검증 (방어적 RingBuffer)
// ============================================================================

/**
 * previousBlockhash 검증
 *
 * Dagaon Core 대응: Block Publisher.verifyChainContinuity()
 *
 * EVM에서는:
 *   parentHash를 RingBuffer에 저장하여 reorg 감지 → 필수!
 *   불일치 시 fork point까지 되돌림
 *
 * Solana에서는:
 *   finalized에서 reorg가 발생하지 않으므로 "방어적" 검증
 *   불일치 시 운영 알림 (자동 되돌림 아님)
 *   → 이것이 트리거되면 RPC 이상 등 비정상 상황
 */
function verifyChainContinuity(
  results: BlockScanResult[]
): { valid: boolean; mismatchAt?: number } {
  console.log("\n=== Step 8: previousBlockhash 연속성 검증 ===");
  console.log("  Dagaon Core 대응: Block Publisher.verifyChainContinuity()");
  console.log("  EVM: parentHash RingBuffer (필수, reorg 감지)");
  console.log("  Solana: previousBlockhash 검증 (방어적, 트리거 안 됨)\n");

  for (let i = 1; i < results.length; i++) {
    const current = results[i];
    const previous = results[i - 1];

    if (current.previousBlockhash !== previous.blockhash) {
      console.log(
        `  [ALERT] previousBlockhash 불일치 at slot ${current.slot}!`
      );
      console.log(
        `    expected: ${previous.blockhash.slice(0, 20)}...`
      );
      console.log(
        `    actual:   ${current.previousBlockhash.slice(0, 20)}...`
      );
      console.log(
        `    ※ finalized에서 이것이 발생하면 RPC 이상입니다!`
      );
      return { valid: false, mismatchAt: current.slot };
    }
  }

  console.log(`  연속 ${results.length}개 블록의 previousBlockhash 검증 통과`);
  console.log(`  ※ finalized commitment이므로 불일치가 발생할 일은 없음\n`);
  return { valid: true };
}

// ============================================================================
// Main: 전체 스캔 파이프라인 실행
// ============================================================================

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Solana Block Scanner PoC                                   ║");
  console.log("║  Dagaon Core Block Publisher + Block Consumer 통합 PoC      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ── Step 1: 현재 finalized 슬롯 조회 ──
  const currentSlot = await getFinalizedSlot();

  // ── Step 2: 유효 슬롯 목록 조회 ──
  const startSlot = currentSlot - SCAN_RANGE;
  const confirmedSlots = await scanSlotRange(startSlot, currentSlot);

  if (confirmedSlots.length === 0) {
    console.log("유효한 슬롯이 없습니다. 잠시 후 재시도하세요.");
    return;
  }

  // ── Step 3~6: 각 슬롯의 블록 스캔 및 transfer 추출 ──
  console.log("=== Step 3~6: 블록 스캔 및 Transfer 추출 ===");
  console.log("  Dagaon Core 대응:");
  console.log("    Block Publisher: getBlock(slot) → Kafka 발행");
  console.log("    Block Consumer:  Kafka 소비 → transfer 추출 → DB 저장\n");

  const results: BlockScanResult[] = [];
  const maxBlocks = Math.min(confirmedSlots.length, 10); // 최대 10개만 처리 (rate limit)

  for (let i = 0; i < maxBlocks; i++) {
    const slot = confirmedSlots[i];

    try {
      const result = await processBlock(slot);
      if (result) {
        results.push(result);
        printBlockResult(result);
      }
    } catch (err: any) {
      // Rate limit 처리
      if (err.message?.includes("429") || err.message?.includes("Too many")) {
        console.log(`  [RATE LIMIT] 슬롯 ${slot} - 2초 대기 후 재시도...`);
        await sleep(2000);
        i--; // 재시도
        continue;
      }
      console.log(`  [ERROR] 슬롯 ${slot}: ${err.message}`);
    }

    // Rate limit 방지: 요청 간 간격
    await sleep(500);
  }

  // ── Step 7: 결과 요약 ──
  console.log("\n=== 결과 요약 ===");
  const totalNative = results.reduce(
    (sum, r) => sum + r.nativeTransfers.length,
    0
  );
  const totalSpl = results.reduce(
    (sum, r) => sum + r.splTokenTransfers.length,
    0
  );
  const totalSuccess = results.reduce(
    (sum, r) => sum + r.successTransactions,
    0
  );
  const totalFailed = results.reduce(
    (sum, r) => sum + r.failedTransactions,
    0
  );

  console.log(`  스캔한 블록:       ${results.length}개`);
  console.log(`  성공 TX:           ${totalSuccess}건`);
  console.log(
    `  실패 TX:           ${totalFailed}건 (meta.err != null, 추출 제외)`
  );
  console.log(`  SOL transfers:     ${totalNative}건`);
  console.log(`  SPL transfers:     ${totalSpl}건`);

  // ── Step 8: 체인 연속성 검증 ──
  if (results.length >= 2) {
    verifyChainContinuity(results);
  }

  // ── Checkpoint 시뮬레이션 ──
  if (results.length > 0) {
    const lastSlot = results[results.length - 1].slot;
    console.log("=== Checkpoint 저장 (etcd 시뮬레이션) ===");
    console.log(`  Dagaon Core 대응: etcd.Put(last_processed_slot, ${lastSlot})`);
    console.log(`  EVM 대응:         etcd.Put(last_processed, block_number)`);
    console.log(`  다음 스캔 시작:   slot ${lastSlot + 1}부터\n`);
  }

  // ── Dagaon Core 파이프라인 매핑 요약 ──
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Dagaon Core 파이프라인 매핑                                 ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  이 코드                     →  Dagaon Core 컴포넌트        ║");
  console.log("║  ──────────────────────       ─────────────────────────     ║");
  console.log("║  getFinalizedSlot()           →  Publisher.getCurrentSlot() ║");
  console.log("║  scanSlotRange()              →  Publisher.getBlocks()      ║");
  console.log("║  fetchBlock()                 →  Publisher.getBlock()       ║");
  console.log("║  extractNativeTransfers()     →  Consumer.extractSOL()     ║");
  console.log("║  extractSplTokenTransfers()   →  Consumer.extractSPL()     ║");
  console.log("║  verifyChainContinuity()      →  Publisher.RingBuffer      ║");
  console.log("║  checkpoint 저장              →  etcd.Put(slot_number)     ║");
  console.log("║  (Event Confirmer 없음!)      →  finalized = 이미 확정     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
}

// ============================================================================
// 유틸리티
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 실행 ──
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

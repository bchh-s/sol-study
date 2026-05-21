/**
 * 07. 트랜잭션 모니터링 + 블록 파싱
 *
 * Dagaon Core 컴포넌트 대응:
 * - Block Publisher: getBlocks + getBlock 으로 블록 스캐닝
 * - Block Consumer: preBalances/postBalances diff로 transfer 추출
 * - Event Confirmer: signatureSubscribe 또는 getSignatureStatuses로 확인
 *
 * EVM과의 차이:
 * - EVM: eth_getBlockByNumber → tx.receipt.logs → Transfer event 파싱
 * - Solana: getBlock → tx.meta.preBalances/postBalances diff + preTokenBalances/postTokenBalances diff
 *
 * EVM에서는 event log를 파싱하지만, Solana에서는 잔액 변화를 직접 비교한다.
 */
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
} from "@solana/spl-token";
import { connection, loadKeypair, explorerUrl, sleep } from "./common";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// Part 1: TX 전송 후 실시간 확인 (signatureSubscribe 대응)
// ============================================================
async function monitorTransaction() {
  console.log("=== Part 1: TX 모니터링 (Event Confirmer 대응) ===\n");
  console.log("EVM: eth_getTransactionReceipt 폴링 또는 newPendingTransactions 구독");
  console.log("Solana: signatureSubscribe (WebSocket) 또는 getSignatureStatuses (HTTP)\n");

  const sender = loadKeypair("main-wallet");
  const receiver = loadKeypair("receiver");

  // SOL 전송 TX 생성
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: receiver.publicKey,
      lamports: 0.001 * LAMPORTS_PER_SOL,
    })
  );

  // --- 방법 A: signatureSubscribe (WebSocket 실시간 알림) ---
  console.log("[방법 A] WebSocket signatureSubscribe");
  console.log("  Dagaon Core tx-monitor에서 사용할 방식\n");

  // TX 전송 (확인 대기 없이)
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = sender.publicKey;
  tx.sign(sender);

  const rawTx = tx.serialize();
  const signature = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    maxRetries: 0, // 자체 재전송 제어 (Dagaon Core tx-sender 패턴)
  });

  console.log(`  TX 전송됨: ${signature.slice(0, 20)}...`);
  console.log(`  상태: BROADCASTED (확인 대기 중)\n`);

  // signatureSubscribe로 확인 대기
  const startTime = Date.now();

  // WebSocket 구독
  const subscriptionId = connection.onSignature(
    signature,
    (result) => {
      const elapsed = Date.now() - startTime;
      if (result.err) {
        console.log(`  [${elapsed}ms] TX 실패: ${JSON.stringify(result.err)}`);
      } else {
        console.log(`  [${elapsed}ms] TX 확인됨! (confirmed)`);
      }
    },
    "confirmed"
  );
  console.log(`  WebSocket 구독 ID: ${subscriptionId}`);

  // --- 방법 B: getSignatureStatuses (HTTP 폴링) ---
  console.log("\n[방법 B] HTTP 폴링 getSignatureStatuses");
  console.log("  WebSocket 불안정할 때의 fallback\n");

  let confirmed = false;
  for (let i = 0; i < 30; i++) {
    const statuses = await connection.getSignatureStatuses([signature]);
    const status = statuses.value[0];

    if (status) {
      const elapsed = Date.now() - startTime;
      console.log(`  [${elapsed}ms] 상태 감지:`);
      console.log(`    confirmationStatus: ${status.confirmationStatus}`);
      console.log(`    confirmations: ${status.confirmations ?? "finalized"}`);
      console.log(`    slot: ${status.slot}`);
      console.log(`    err: ${status.err ? JSON.stringify(status.err) : "null (성공)"}`);

      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        confirmed = true;
        break;
      }
    }
    await sleep(500);
  }

  if (!confirmed) {
    console.log("  30번 폴링 후에도 미확인 (timeout)");
  }

  // WebSocket 구독 해제
  await connection.removeSignatureListener(subscriptionId);

  // --- Commitment Level별 확인 ---
  console.log("\n[Commitment Level 비교]");
  console.log("  EVM 대응: confirmations 카운트 (1, 6, 12, 64...)");
  console.log("  Solana: processed → confirmed → finalized\n");

  const startFinalized = Date.now();
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "finalized"
  );
  console.log(`  finalized 확인: ${Date.now() - startFinalized}ms 소요`);
  console.log(`  ※ finalized = EVM의 64 confirmations에 해당 (되돌릴 수 없음)`);

  return signature;
}

// ============================================================
// Part 2: 블록 데이터 가져오기 및 파싱 (Block Publisher/Consumer 대응)
// ============================================================
async function parseBlock(txSignature: string) {
  console.log("\n\n=== Part 2: 블록 파싱 (Block Publisher/Consumer 대응) ===\n");

  // --- TX에서 슬롯 번호 확인 ---
  const txDetail = await connection.getTransaction(txSignature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });

  if (!txDetail) {
    console.log("TX를 찾을 수 없음");
    return;
  }

  const targetSlot = txDetail.slot;
  console.log(`[대상 슬롯] ${targetSlot}\n`);

  // --- 블록 전체 데이터 가져오기 (Block Publisher의 getBlock 호출) ---
  console.log("[블록 데이터 조회]");
  console.log("  EVM: eth_getBlockByNumber(blockNumber, true)");
  console.log("  Solana: getBlock(slot)\n");

  const block = await connection.getBlock(targetSlot, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
    transactionDetails: "full",
  });

  if (!block) {
    console.log("블록을 찾을 수 없음 (빈 슬롯일 수 있음)");
    return;
  }

  // --- 블록 헤더 정보 ---
  console.log("[블록 헤더]");
  console.log(`  slot:              ${targetSlot}`);
  console.log(`  blockHeight:       ${(block as any).blockHeight ?? "N/A"} (slot ≠ blockHeight)`);
  console.log(`  blockhash:         ${block.blockhash}`);
  console.log(`  previousBlockhash: ${block.previousBlockhash} (← RingBuffer 검증용)`);
  console.log(`  parentSlot:        ${block.parentSlot}`);
  console.log(`  blockTime:         ${block.blockTime ? new Date(block.blockTime * 1000).toISOString() : "N/A"}`);
  console.log(`  TX 수:             ${block.transactions.length}`);

  // --- 블록 내 트랜잭션 파싱 (Block Consumer 역할) ---
  console.log("\n[블록 내 TX 파싱] (Block Consumer가 하는 일)");
  console.log("  EVM: receipt.logs → Transfer(from,to,value) event 파싱");
  console.log("  Solana: preBalances/postBalances diff로 transfer 추출\n");

  let transferCount = 0;

  for (let txIdx = 0; txIdx < block.transactions.length; txIdx++) {
    const txData = block.transactions[txIdx];
    const meta = txData.meta;

    if (!meta) continue;

    // 실패 TX 건너뛰기 (EVM과 달리 실패 TX도 블록에 포함됨!)
    if (meta.err !== null) continue;

    const accounts = txData.transaction.message.staticAccountKeys;

    // --- Native SOL 전송 감지 (preBalances vs postBalances) ---
    const preBalances = meta.preBalances;
    const postBalances = meta.postBalances;

    for (let i = 0; i < accounts.length; i++) {
      const diff = postBalances[i] - preBalances[i];
      // fee 차감과 실제 전송을 구분하기 위해:
      // fee payer(index 0)는 fee만큼 빠지므로, diff + fee 가 0이면 fee만 냄
      // 수신 계정은 diff > 0이면 SOL 수신
      if (diff > 0 && diff >= 1000) { // 의미 있는 금액만 (>= 1000 lamports)
        transferCount++;
        if (transferCount <= 5) { // 처음 5개만 출력
          const sig = txData.transaction.signatures[0];
          console.log(`  [Native SOL 수신]`);
          console.log(`    TX: ${sig.slice(0, 20)}...`);
          console.log(`    to: ${accounts[i].toBase58().slice(0, 16)}...`);
          console.log(`    amount: ${(diff / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
        }
      }
    }

    // --- SPL Token 전송 감지 (preTokenBalances vs postTokenBalances) ---
    const preTokenBalances = meta.preTokenBalances ?? [];
    const postTokenBalances = meta.postTokenBalances ?? [];

    // postTokenBalances에서 잔액이 증가한 계정 찾기
    for (const post of postTokenBalances) {
      const pre = preTokenBalances.find(
        (p) => p.accountIndex === post.accountIndex
      );
      const preAmount = pre ? Number(pre.uiTokenAmount.amount) : 0;
      const postAmount = Number(post.uiTokenAmount.amount);
      const diff = postAmount - preAmount;

      if (diff > 0) {
        transferCount++;
        if (transferCount <= 5) {
          const sig = txData.transaction.signatures[0];
          console.log(`  [SPL Token 수신]`);
          console.log(`    TX: ${sig.slice(0, 20)}...`);
          console.log(`    mint: ${post.mint.slice(0, 16)}...`);
          console.log(`    owner: ${post.owner?.slice(0, 16) ?? "unknown"}...`);
          console.log(`    amount: ${diff / 10 ** (post.uiTokenAmount.decimals)} tokens`);
        }
      }
    }
  }

  console.log(`\n  총 감지된 transfer: ${transferCount}건`);
  if (transferCount > 5) {
    console.log(`  (처음 5건만 출력)`);
  }

  // --- Block Publisher의 슬롯 스캐닝 시뮬레이션 ---
  console.log("\n\n[슬롯 스캐닝 시뮬레이션] (Block Publisher 패턴)");
  console.log("  EVM: getBlockByNumber(n); n++");
  console.log("  Solana: getBlocks(start, end) → 빈 슬롯 제외한 목록 → getBlock(slot)\n");

  const currentSlot = await connection.getSlot("finalized");
  const startSlot = currentSlot - 10;

  // getBlocks: 범위 내에서 실제 블록이 있는 슬롯만 반환
  const confirmedSlots = await connection.getBlocks(startSlot, currentSlot, "finalized");

  console.log(`  스캔 범위: ${startSlot} ~ ${currentSlot} (${currentSlot - startSlot + 1}개 슬롯)`);
  console.log(`  실제 블록 존재: ${confirmedSlots.length}개 슬롯`);
  console.log(`  빈 슬롯: ${currentSlot - startSlot + 1 - confirmedSlots.length}개 (스킵됨)`);
  console.log(`\n  슬롯 목록: [${confirmedSlots.slice(0, 5).join(", ")}${confirmedSlots.length > 5 ? ", ..." : ""}]`);

  // 각 슬롯의 블록 정보 요약
  console.log("\n  [슬롯별 블록 요약]");
  for (const slot of confirmedSlots.slice(0, 3)) {
    const blk = await connection.getBlock(slot, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
      transactionDetails: "full",
    });
    if (blk) {
      const successTxs = blk.transactions.filter((t) => t.meta?.err === null).length;
      const failedTxs = blk.transactions.length - successTxs;
      console.log(`    Slot ${slot}: height=${(blk as any).blockHeight ?? "N/A"}, txs=${successTxs} ok / ${failedTxs} fail, hash=${blk.blockhash.slice(0, 16)}...`);
    }
  }
  if (confirmedSlots.length > 3) {
    console.log(`    ... (${confirmedSlots.length - 3}개 더)`);
  }
}

// ============================================================
// Part 3: 특정 주소의 TX 히스토리 조회
// ============================================================
async function addressHistory() {
  console.log("\n\n=== Part 3: 주소별 TX 히스토리 ===\n");
  console.log("EVM: eth_getTransactionsByAddress (비표준) 또는 etherscan API");
  console.log("Solana: getSignaturesForAddress (RPC 네이티브 지원)\n");

  const mainWallet = loadKeypair("main-wallet");

  const signatures = await connection.getSignaturesForAddress(
    mainWallet.publicKey,
    { limit: 5 },
    "finalized"
  );

  console.log(`[${mainWallet.publicKey.toBase58().slice(0, 12)}... 의 최근 TX]`);
  for (const sig of signatures) {
    const time = sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : "N/A";
    const status = sig.err ? "FAIL" : "OK";
    console.log(`  ${status} | slot ${sig.slot} | ${time} | ${sig.signature.slice(0, 20)}...`);
    if (sig.memo) {
      console.log(`       memo: ${sig.memo}`);
    }
  }

  console.log(`\n  총 ${signatures.length}건 (limit: 5)`);
}

// ============================================================
// 실행
// ============================================================
async function main() {
  const txSignature = await monitorTransaction();
  await parseBlock(txSignature);
  await addressHistory();

  console.log("\n\n=== 전체 예제 완료 ===");
  console.log("Dagaon Core 컴포넌트 매핑:");
  console.log("  Block Publisher → getBlocks + getBlock (슬롯 스캐닝)");
  console.log("  Block Consumer  → preBalances/postBalances diff (transfer 추출)");
  console.log("  Event Confirmer → signatureSubscribe + getSignatureStatuses");
  console.log("  tx-sender       → sendRawTransaction + 2초 재전송 루프");
  console.log("  tx-monitor      → getSignatureStatuses 폴링");
}

main().catch(console.error);

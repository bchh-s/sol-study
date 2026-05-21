/**
 * Durable Nonce 기반 TX 전송/재전송 데모
 * ──────────────────────────────────────
 *
 * Dagaon Core의 Solana 출금 파이프라인에서 핵심이 되는 Durable Nonce를
 * devnet에서 실제로 생성하고, nonce 기반 TX를 전송하며, 취소하는 전체
 * 라이프사이클을 시연한다.
 *
 * 단계:
 *   1. Durable Nonce 계정 생성 (CreateAccount + InitializeNonceAccount)
 *   2. storedNonce 값 조회
 *   3. Durable Nonce 기반 SOL 전송 TX 빌드 (AdvanceNonceAccount 첫 번째)
 *   4. 서명 및 전송
 *   5. TX 확인 + nonce 값 변경 확인
 *   6. 취소 시연: AdvanceNonce만 실행하여 기존 nonce 무효화
 *
 * 실행: npm run demo  (또는 npx tsx durable-nonce-demo.ts)
 * 사전조건: devnet에 airdrop 가능한 네트워크 환경
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

// ─────────────────────────────────────────────────────────────
// 유틸리티 함수
// ─────────────────────────────────────────────────────────────

function divider(title: string): void {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70) + '\n');
}

function shortPubkey(pubkey: PublicKey | string): string {
  const str = typeof pubkey === 'string' ? pubkey : pubkey.toBase58();
  return `${str.slice(0, 8)}...${str.slice(-6)}`;
}

async function getStoredNonce(
  connection: Connection,
  nonceAccountPubkey: PublicKey
): Promise<{ nonce: string; authority: PublicKey }> {
  const accountInfo = await connection.getAccountInfo(nonceAccountPubkey);
  if (!accountInfo) {
    throw new Error(`Nonce 계정을 찾을 수 없음: ${nonceAccountPubkey.toBase58()}`);
  }
  const nonceAccount = NonceAccount.fromAccountData(accountInfo.data);
  return {
    nonce: nonceAccount.nonce,
    authority: nonceAccount.authorizedPubkey,
  };
}

async function airdropAndConfirm(
  connection: Connection,
  pubkey: PublicKey,
  lamports: number
): Promise<void> {
  console.log(`  에어드롭 요청: ${lamports / LAMPORTS_PER_SOL} SOL → ${shortPubkey(pubkey)}`);
  const sig = await connection.requestAirdrop(pubkey, lamports);
  await connection.confirmTransaction(sig, 'confirmed');
  console.log(`  에어드롭 확인: ${shortPubkey(sig)}`);
}

// ─────────────────────────────────────────────────────────────
// 메인 실행
// ─────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // ─────────────────────────────────────────────────────────
  // 0단계: 키쌍 생성 및 airdrop
  // ─────────────────────────────────────────────────────────

  divider('0단계: 키쌍 생성 및 SOL 에어드롭');

  /**
   * authority: nonce 계정의 authority이자 feePayer (Dagaon Core에서는 hot wallet)
   * nonceKeypair: nonce 계정 자체의 키쌍 (계정 생성 시에만 사용, 이후 authority만 필요)
   * recipient: SOL 수신자 (출금 대상)
   */
  const authority = Keypair.generate();
  const nonceKeypair = Keypair.generate();
  const recipient = Keypair.generate();

  console.log(`  authority (hot wallet): ${shortPubkey(authority.publicKey)}`);
  console.log(`  nonce 계정:            ${shortPubkey(nonceKeypair.publicKey)}`);
  console.log(`  수신자:                ${shortPubkey(recipient.publicKey)}`);

  // authority에 SOL 에어드롭 (nonce 계정 생성 + TX 수수료 + 전송 금액)
  await airdropAndConfirm(connection, authority.publicKey, 2 * LAMPORTS_PER_SOL);

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`\n  authority 잔액: ${balance / LAMPORTS_PER_SOL} SOL`);

  // ─────────────────────────────────────────────────────────
  // 1단계: Durable Nonce 계정 생성
  // ─────────────────────────────────────────────────────────

  divider('1단계: Durable Nonce 계정 생성');

  /**
   * Nonce 계정 생성은 2개의 instruction을 하나의 TX에 포함:
   *   1. CreateAccount: 새 계정 생성 + rent-exempt SOL 예치
   *   2. InitializeNonceAccount: nonce 계정으로 초기화 + authority 지정
   *
   * Dagaon Core에서는 hot wallet이 authority가 되어,
   * 출금 TX 서명 시 feePayer와 authority가 동일한 키로 처리된다.
   */

  const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(
    NONCE_ACCOUNT_LENGTH
  );

  console.log(`  nonce 계정 데이터 크기: ${NONCE_ACCOUNT_LENGTH} bytes`);
  console.log(`  rent-exempt 비용: ${rentExemptBalance / LAMPORTS_PER_SOL} SOL`);
  console.log(`  (이 비용은 계정을 닫을 때 전액 반환됨)`);

  const createNonceTx = new Transaction().add(
    // Instruction 1: 새 계정 생성
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: nonceKeypair.publicKey,
      lamports: rentExemptBalance,
      space: NONCE_ACCOUNT_LENGTH,
      programId: SystemProgram.programId,
    }),
    // Instruction 2: Nonce 계정으로 초기화
    SystemProgram.nonceInitialize({
      noncePubkey: nonceKeypair.publicKey,
      authorizedPubkey: authority.publicKey, // authority = hot wallet
    })
  );

  console.log('\n  nonce 계정 생성 TX 전송 중...');

  const createSig = await sendAndConfirmTransaction(
    connection,
    createNonceTx,
    [authority, nonceKeypair], // authority(feePayer) + nonceKeypair(새 계정 소유자)
    { commitment: 'confirmed' }
  );

  console.log(`  생성 TX 확인: ${shortPubkey(createSig)}`);
  console.log(`  Solana Explorer: https://explorer.solana.com/tx/${createSig}?cluster=devnet`);

  // ─────────────────────────────────────────────────────────
  // 2단계: storedNonce 값 조회
  // ─────────────────────────────────────────────────────────

  divider('2단계: storedNonce 값 조회');

  /**
   * storedNonce는 nonce 계정에 저장된 32바이트 값이다.
   * base58 인코딩되어 있으며, blockhash와 동일한 형태이다.
   * TX의 recentBlockhash 필드에 이 값을 넣으면 durable nonce TX가 된다.
   *
   * Dagaon Core의 tx-preparer가 수행하는 작업:
   *   1. nonce 풀에서 FREE 계정 할당 (DB row lock)
   *   2. 이 RPC 호출로 storedNonce 조회
   *   3. TX 빌드 시 recentBlockhash = storedNonce
   */

  const { nonce: initialNonce, authority: nonceAuthority } = await getStoredNonce(
    connection,
    nonceKeypair.publicKey
  );

  console.log(`  nonce 계정: ${shortPubkey(nonceKeypair.publicKey)}`);
  console.log(`  storedNonce: ${initialNonce}`);
  console.log(`  authority: ${shortPubkey(nonceAuthority)}`);
  console.log(`  authority == hot wallet: ${nonceAuthority.equals(authority.publicKey)}`);

  // 일반 blockhash와 비교
  const { blockhash: recentBlockhash } = await connection.getLatestBlockhash();
  console.log(`\n  [비교] 일반 recentBlockhash: ${recentBlockhash}`);
  console.log(`  [비교] storedNonce:          ${initialNonce}`);
  console.log(`  → 형태는 동일하지만, storedNonce는 만료되지 않음`);

  // ─────────────────────────────────────────────────────────
  // 3단계: Durable Nonce 기반 SOL 전송 TX 빌드
  // ─────────────────────────────────────────────────────────

  divider('3단계: Durable Nonce 기반 SOL 전송 TX 빌드');

  /**
   * Durable Nonce TX의 핵심 규칙:
   *   1. recentBlockhash = storedNonce (일반 blockhash 대신)
   *   2. 첫 번째 instruction = AdvanceNonceAccount (필수!)
   *   3. 나머지 instruction = 실제 작업 (Transfer 등)
   *
   * AdvanceNonceAccount가 첫 번째가 아니면
   * Solana 런타임이 TX를 거부한다 (BlockhashNotFound 에러).
   *
   * Dagaon Core에서는 tx-preparer가 이 TX를 빌드하고,
   * tx-signer가 KMS로 서명한다.
   */

  const transferAmount = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL 전송

  const durableNonceTx = new Transaction();

  // 핵심: recentBlockhash 대신 storedNonce 사용
  durableNonceTx.recentBlockhash = initialNonce;
  durableNonceTx.feePayer = authority.publicKey;

  // 핵심: AdvanceNonceAccount가 반드시 첫 번째 instruction
  durableNonceTx.add(
    // Instruction[0]: AdvanceNonceAccount (필수, 첫 번째)
    SystemProgram.nonceAdvance({
      noncePubkey: nonceKeypair.publicKey,
      authorizedPubkey: authority.publicKey,
    }),
    // Instruction[1]: 실제 SOL 전송
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: recipient.publicKey,
      lamports: transferAmount,
    })
  );

  console.log('  TX 구성:');
  console.log(`    recentBlockhash: ${initialNonce} (storedNonce)`);
  console.log(`    feePayer: ${shortPubkey(authority.publicKey)}`);
  console.log(`    instruction[0]: AdvanceNonceAccount`);
  console.log(`      noncePubkey: ${shortPubkey(nonceKeypair.publicKey)}`);
  console.log(`      authorizedPubkey: ${shortPubkey(authority.publicKey)}`);
  console.log(`    instruction[1]: Transfer`);
  console.log(`      from: ${shortPubkey(authority.publicKey)}`);
  console.log(`      to: ${shortPubkey(recipient.publicKey)}`);
  console.log(`      amount: ${transferAmount / LAMPORTS_PER_SOL} SOL`);

  // ─────────────────────────────────────────────────────────
  // 4단계: 서명 및 전송
  // ─────────────────────────────────────────────────────────

  divider('4단계: 서명 및 전송');

  /**
   * 실제 Dagaon Core에서의 흐름:
   *   tx-signer:
   *     1. TX message serialize
   *     2. KMS Sign (EDDSA_ED25519_SHA_512, MessageType=RAW)
   *     3. 64바이트 raw 서명을 TX에 첨부
   *     4. DB 저장 (signed_tx, tx_signature, status=SIGNED)
   *
   *   tx-sender:
   *     1. sendTransaction(signedTx, { maxRetries: 0 })
   *     2. signatureSubscribe(txSignature)
   *     3. 2초 간격 재전송 루프
   *
   * 이 데모에서는 sendAndConfirmTransaction으로 간소화한다.
   * 실제 프로덕션에서는 위의 분리된 흐름을 따라야 한다.
   */

  console.log('  TX 서명 및 전송 중...');
  console.log('  (실제 Dagaon Core: KMS Sign → sendTransaction(maxRetries=0) → 2초 재전송 루프)');

  const transferSig = await sendAndConfirmTransaction(
    connection,
    durableNonceTx,
    [authority], // authority만 서명 (feePayer이자 nonce authority)
    { commitment: 'confirmed' }
  );

  console.log(`\n  TX 확인됨!`);
  console.log(`  signature: ${transferSig}`);
  console.log(`  Solana Explorer: https://explorer.solana.com/tx/${transferSig}?cluster=devnet`);

  // ─────────────────────────────────────────────────────────
  // 5단계: TX 확인 + nonce 값 변경 확인
  // ─────────────────────────────────────────────────────────

  divider('5단계: TX 확인 + nonce 값 변경 확인');

  /**
   * TX가 성공적으로 처리되면:
   *   1. AdvanceNonceAccount가 실행되어 storedNonce가 변경됨
   *   2. Transfer가 실행되어 SOL이 전송됨
   *
   * storedNonce 변경 = TX가 온체인에서 처리됨의 증거
   *
   * Dagaon Core의 tx-monitor가 확인하는 것:
   *   - getSignatureStatuses로 confirmationStatus 확인
   *   - storedNonce 변경 여부로 TX 처리 여부 이중 확인
   */

  // 수신자 잔액 확인
  const recipientBalance = await connection.getBalance(recipient.publicKey);
  console.log(`  수신자 잔액: ${recipientBalance / LAMPORTS_PER_SOL} SOL`);
  console.log(`  전송 금액 일치: ${recipientBalance === transferAmount}`);

  // storedNonce 변경 확인
  const { nonce: nonceAfterTransfer } = await getStoredNonce(
    connection,
    nonceKeypair.publicKey
  );

  console.log(`\n  storedNonce 변경 확인:`);
  console.log(`    이전: ${initialNonce}`);
  console.log(`    이후: ${nonceAfterTransfer}`);
  console.log(`    변경됨: ${initialNonce !== nonceAfterTransfer}`);

  if (initialNonce === nonceAfterTransfer) {
    console.log('  [경고] storedNonce가 변경되지 않음 - TX가 처리되지 않았을 수 있음');
  } else {
    console.log('  [확인] storedNonce 변경됨 = TX가 온체인에서 처리됨');
  }

  // TX 상태 확인
  const sigStatus = await connection.getSignatureStatuses([transferSig]);
  const status = sigStatus.value[0];
  console.log(`\n  TX 상태:`);
  console.log(`    confirmationStatus: ${status?.confirmationStatus}`);
  console.log(`    slot: ${status?.slot}`);
  console.log(`    err: ${status?.err ? JSON.stringify(status.err) : 'null (성공)'}`);

  // ─────────────────────────────────────────────────────────
  // 6단계: 취소 시연 - Nonce Advance로 TX 무효화
  // ─────────────────────────────────────────────────────────

  divider('6단계: 취소 시연 - Nonce Advance로 TX 무효화');

  /**
   * 취소 시나리오:
   *   1. 출금 TX를 서명했지만 아직 전송하지 않았거나, 전송했지만 확인되지 않은 상태
   *   2. 출금을 취소하고 싶음
   *   3. AdvanceNonceAccount만 실행하면 기존 서명된 TX가 무효화됨
   *
   * 이 데모에서는:
   *   a. 새 TX를 빌드하고 서명 (전송하지 않음)
   *   b. nonce advance를 실행하여 storedNonce 변경
   *   c. 기존 서명된 TX를 전송 시도 → 실패 확인
   *
   * Dagaon Core에서의 사용 케이스:
   *   - 잘못된 금액으로 서명된 TX → nonce advance로 무효화
   *   - 오래 확인되지 않는 TX → nonce advance 후 priority fee 올려서 재생성
   *   - 출금 요청 자체가 취소됨 → nonce advance로 서명된 TX 무효화
   */

  // 6-a: 새 전송 TX를 빌드하고 서명 (전송하지 않음)
  console.log('  [6-a] 새 전송 TX를 빌드하고 서명 (아직 전송하지 않음)');

  const currentNonce = nonceAfterTransfer; // 현재 storedNonce

  const pendingTx = new Transaction();
  pendingTx.recentBlockhash = currentNonce; // 현재 storedNonce 사용
  pendingTx.feePayer = authority.publicKey;
  pendingTx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: nonceKeypair.publicKey,
      authorizedPubkey: authority.publicKey,
    }),
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: recipient.publicKey,
      lamports: 0.005 * LAMPORTS_PER_SOL,
    })
  );

  // 서명 (실제로는 KMS를 통해 서명)
  pendingTx.sign(authority);
  const pendingTxSerialized = pendingTx.serialize();

  console.log(`    storedNonce 사용: ${currentNonce}`);
  console.log(`    서명 완료. 직렬화된 TX: ${pendingTxSerialized.length} bytes`);
  console.log('    (이 TX는 아직 전송하지 않음 - 취소 시연을 위해 보류)');

  // 6-b: Nonce Advance 실행 (취소)
  console.log('\n  [6-b] Nonce Advance 실행 (취소)');
  console.log('    AdvanceNonceAccount만 포함한 TX를 전송하여 storedNonce를 변경합니다.');

  /**
   * 취소 TX에서는 일반 recentBlockhash를 사용한다.
   * (durable nonce가 아닌 일반 TX로 전송)
   * AdvanceNonceAccount만 실행하면 storedNonce가 갱신되어
   * 이전 storedNonce를 사용한 모든 미결 TX가 무효화된다.
   */
  const cancelTx = new Transaction();
  const { blockhash: cancelBlockhash } = await connection.getLatestBlockhash();
  cancelTx.recentBlockhash = cancelBlockhash;
  cancelTx.feePayer = authority.publicKey;
  cancelTx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: nonceKeypair.publicKey,
      authorizedPubkey: authority.publicKey,
    })
  );

  const cancelSig = await sendAndConfirmTransaction(
    connection,
    cancelTx,
    [authority],
    { commitment: 'confirmed' }
  );

  console.log(`    취소 TX 확인: ${shortPubkey(cancelSig)}`);

  // storedNonce 변경 확인
  const { nonce: nonceAfterCancel } = await getStoredNonce(
    connection,
    nonceKeypair.publicKey
  );

  console.log(`\n    storedNonce 변경 확인:`);
  console.log(`      취소 전: ${currentNonce}`);
  console.log(`      취소 후: ${nonceAfterCancel}`);
  console.log(`      변경됨: ${currentNonce !== nonceAfterCancel}`);

  // 6-c: 이전에 서명한 TX 전송 시도 → 실패 확인
  console.log('\n  [6-c] 이전에 서명한 TX 전송 시도 (실패 예상)');
  console.log('    storedNonce가 변경되었으므로 이전 서명된 TX는 무효화됨');

  try {
    await connection.sendRawTransaction(pendingTxSerialized, {
      skipPreflight: false,
    });
    console.log('    [예상 외] TX가 전송됨 - 이런 경우는 발생하지 않아야 함');
  } catch (err: any) {
    console.log(`    [예상대로] TX 전송 실패!`);
    // 에러 메시지에서 핵심 정보 추출
    const errMsg = err.message || String(err);
    if (errMsg.includes('Blockhash not found') || errMsg.includes('BlockhashNotFound')) {
      console.log(`    에러: Blockhash not found`);
      console.log(`    → storedNonce가 변경되어 이전 nonce(${shortPubkey(currentNonce)})가 더 이상 유효하지 않음`);
    } else {
      console.log(`    에러: ${errMsg.substring(0, 200)}`);
    }
    console.log('\n    이것이 Durable Nonce 취소의 원리:');
    console.log('    AdvanceNonce를 실행하면 storedNonce가 변경되어');
    console.log('    이전 storedNonce로 서명된 모든 TX가 자동 무효화됨');
  }

  // ─────────────────────────────────────────────────────────
  // 요약
  // ─────────────────────────────────────────────────────────

  divider('요약: Dagaon Core 출금 파이프라인에서의 Durable Nonce');

  console.log('시연 완료! 전체 라이프사이클:');
  console.log('');
  console.log('  1. Nonce 계정 생성 (CreateAccount + InitializeNonce)');
  console.log(`     → 계정: ${shortPubkey(nonceKeypair.publicKey)}`);
  console.log(`     → 비용: ${rentExemptBalance / LAMPORTS_PER_SOL} SOL (반환 가능)`);
  console.log('');
  console.log('  2. storedNonce 조회');
  console.log(`     → 초기값: ${shortPubkey(initialNonce)}`);
  console.log('');
  console.log('  3. Durable Nonce TX 빌드');
  console.log('     → recentBlockhash = storedNonce');
  console.log('     → instruction[0] = AdvanceNonceAccount (필수!)');
  console.log('     → instruction[1] = Transfer (실제 작업)');
  console.log('');
  console.log('  4. TX 전송 및 확인');
  console.log(`     → signature: ${shortPubkey(transferSig)}`);
  console.log(`     → storedNonce 변경: ${shortPubkey(initialNonce)} → ${shortPubkey(nonceAfterTransfer)}`);
  console.log('');
  console.log('  5. 취소 시연');
  console.log('     → AdvanceNonce만 실행 → storedNonce 변경');
  console.log('     → 이전 서명된 TX가 무효화됨 (BlockhashNotFound)');
  console.log('');
  console.log('Dagaon Core 적용 포인트:');
  console.log('  - tx-preparer: nonce 풀에서 FREE 계정 할당 + storedNonce 조회');
  console.log('  - tx-signer:   KMS Sign(RAW, Ed25519) → 64B 서명');
  console.log('  - tx-sender:   sendTransaction(maxRetries=0) + 2초 재전송 루프');
  console.log('  - tx-monitor:  getSignatureStatuses + storedNonce 변화 감시');
  console.log('  - 취소:        AdvanceNonce만 실행 → 기존 TX 무효화');
  console.log('');
}

// ─────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────

main()
  .then(() => {
    console.log('데모 완료!\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n데모 실행 중 오류 발생:', err);
    console.error('\n일반적인 원인:');
    console.error('  - devnet 에어드롭 한도 초과 (잠시 후 재시도)');
    console.error('  - 네트워크 연결 문제');
    console.error('  - devnet 일시적 불안정');
    process.exit(1);
  });

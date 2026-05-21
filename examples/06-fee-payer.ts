/**
 * 06. Fee Payer 지정 (수수료 대납 / Gasless Transaction)
 *
 * EVM과의 차이:
 * - EVM: meta-transaction (EIP-2771), Forwarder 컨트랙트, Paymaster (EIP-4337) 등
 *        복잡한 인프라 필요 (relay 서버, 서명 검증 컨트랙트, 추가 gas 오버헤드 30-50%)
 *
 * - Solana: TX의 첫 번째 서명자 = fee payer. 끝.
 *        스마트 컨트랙트 불필요, relay 불필요, 추가 오버헤드 0%
 *
 * 시나리오:
 *   유저(sender)가 토큰을 전송하는데, 수수료는 feePayer가 대신 냄.
 *   유저 지갑에는 SOL이 없어도 됨.
 */
import {
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAccount,
} from "@solana/spl-token";
import { connection, loadKeypair, getBalance, explorerUrl } from "./common";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("=== Fee Payer 지정 (Gasless Transaction) ===\n");
  console.log("EVM: meta-tx + Forwarder 컨트랙트 + relay 서버 필요");
  console.log("Solana: feePayer 필드만 지정하면 끝. 프로토콜 네이티브 기능.\n");

  const sender = loadKeypair("main-wallet");   // 토큰 보내는 사람
  const receiver = loadKeypair("receiver");    // 토큰 받는 사람
  const feePayer = loadKeypair("fee-payer");   // 수수료 대납자 (별도 지갑)

  // --- 예시 1: Native SOL 전송 + Fee Payer 분리 ---
  console.log("[예시 1] SOL 전송, 수수료는 다른 지갑이 부담");
  console.log(`  sender (SOL 보내는 사람):  ${sender.publicKey.toBase58().slice(0, 12)}...`);
  console.log(`  receiver (SOL 받는 사람): ${receiver.publicKey.toBase58().slice(0, 12)}...`);
  console.log(`  feePayer (수수료 부담):   ${feePayer.publicKey.toBase58().slice(0, 12)}...`);

  // 잔액 확인
  console.log(`\n  [전송 전 잔액]`);
  console.log(`    sender:   ${await getBalance(sender.publicKey.toBase58())}`);
  console.log(`    feePayer: ${await getBalance(feePayer.publicKey.toBase58())}`);

  // Transaction 구성 - feePayer를 명시적으로 지정
  const tx1 = new Transaction();
  tx1.feePayer = feePayer.publicKey;  // ← 이것만으로 fee delegation 완료!

  tx1.add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: receiver.publicKey,
      lamports: 0.01 * LAMPORTS_PER_SOL,
    })
  );

  /**
   * signers 배열 순서:
   * - feePayer가 첫 번째 (TX 서명 순서와 무관, feePayer 필드로 지정)
   * - sender도 서명 필요 (자기 SOL을 보내니까)
   *
   * EVM 대비 장점:
   * - feePayer는 sender의 private key를 알 필요 없음
   * - sender는 feePayer의 private key를 알 필요 없음
   * - 각자 자기 부분만 서명
   */
  const sig1 = await sendAndConfirmTransaction(connection, tx1, [
    feePayer,  // fee payer 서명 (수수료 지불)
    sender,    // sender 서명 (SOL 전송 권한)
  ]);

  console.log(`\n  TX: ${explorerUrl(sig1)}`);
  console.log(`\n  [전송 후 잔액]`);
  console.log(`    sender:   ${await getBalance(sender.publicKey.toBase58())} (0.01 SOL만 빠짐, 수수료 안 빠짐!)`);
  console.log(`    feePayer: ${await getBalance(feePayer.publicKey.toBase58())} (수수료만 빠짐)`);

  // TX 상세에서 fee payer 확인
  const txDetail1 = await connection.getTransaction(sig1, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (txDetail1) {
    const accounts = txDetail1.transaction.message.staticAccountKeys;
    console.log(`\n  [TX 분석]`);
    console.log(`    fee payer (accounts[0]): ${accounts[0].toBase58().slice(0, 12)}...`);
    console.log(`    fee 차감: ${txDetail1.meta?.fee} lamports`);
    console.log(`    ※ accounts[0]에서만 fee가 차감됨`);
  }

  // --- 예시 2: SPL Token 전송 + Fee Payer 분리 (커스터디얼 모델) ---
  console.log("\n\n[예시 2] SPL Token 전송, sender에 SOL 없어도 가능");
  console.log("  커스터디얼 지갑 모델: 유저는 토큰만 보유, 가스비는 시스템이 대납\n");

  const mintStr = JSON.parse(
    fs.readFileSync(path.join(__dirname, ".keys", "token-mint.json"), "utf-8")
  );
  const mint = new PublicKey(mintStr);

  // ATA 준비
  const senderAta = await getOrCreateAssociatedTokenAccount(
    connection, feePayer, mint, sender.publicKey
  );
  const receiverAta = await getOrCreateAssociatedTokenAccount(
    connection, feePayer, mint, receiver.publicKey
  );

  const senderTokenBefore = await getAccount(connection, senderAta.address);
  console.log(`  sender 토큰 잔액: ${Number(senderTokenBefore.amount) / 1e6} tokens`);

  // fee payer가 수수료를 대신 냄
  const tx2 = new Transaction();
  tx2.feePayer = feePayer.publicKey;  // ← fee delegation!

  tx2.add(
    createTransferInstruction(
      senderAta.address,     // from (sender의 ATA)
      receiverAta.address,   // to (receiver의 ATA)
      sender.publicKey,      // owner (sender가 서명 필요)
      100 * 10 ** 6          // 100 tokens
    )
  );

  const sig2 = await sendAndConfirmTransaction(connection, tx2, [
    feePayer,  // fee 지불
    sender,    // 토큰 전송 권한
  ]);

  console.log(`  TX: ${explorerUrl(sig2)}`);

  const senderTokenAfter = await getAccount(connection, senderAta.address);
  const receiverTokenAfter = await getAccount(connection, receiverAta.address);
  console.log(`\n  [결과]`);
  console.log(`    sender 토큰: ${Number(senderTokenAfter.amount) / 1e6} tokens`);
  console.log(`    receiver 토큰: ${Number(receiverTokenAfter.amount) / 1e6} tokens`);
  console.log(`    sender SOL: 변동 없음 (수수료 안 냄)`);
  console.log(`    feePayer SOL: 수수료만큼 차감`);

  // --- 요약 ---
  console.log("\n\n[요약: EVM vs Solana Fee Delegation]");
  console.log("┌───────────────────────────────────────────────────────┐");
  console.log("│ EVM                                                   │");
  console.log("│  1. Forwarder 컨트랙트 배포                              │");
  console.log("│  2. Relay 서버 운영                                     │");
  console.log("│  3. 유저가 meta-tx에 서명                                │");
  console.log("│  4. Relay가 wrapping하여 전송                            │");
  console.log("│  5. 컨트랙트가 서명 검증 후 실행                            │");
  console.log("│  → 추가 gas 30-50%, 인프라 복잡도 높음                     │");
  console.log("├───────────────────────────────────────────────────────┤");
  console.log("│ Solana                                                │");
  console.log("│  1. tx.feePayer = feePayerWallet                      │");
  console.log("│  2. 끝.                                               │");
  console.log("│  → 추가 비용 0%, 프로토콜 네이티브 기능                      │");
  console.log("└───────────────────────────────────────────────────────┘");

  console.log("\n다음 단계: npm run 07 (TX 모니터링 및 블록 파싱)");
}

main().catch(console.error);

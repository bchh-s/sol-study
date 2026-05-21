/**
 * 04. Native SOL 전송
 *
 * EVM과의 차이:
 * - EVM: {to, value, gasLimit, maxFeePerGas, nonce} → RLP 인코딩 → 서명
 * - Solana: Transaction { instructions: [SystemProgram.transfer()] } → 서명
 *
 * 핵심 차이:
 * 1. nonce 없음 → recentBlockhash 사용 (60-90초 후 만료)
 * 2. to 필드 없음 → instruction 내 accounts 배열에 포함
 * 3. value 필드 없음 → instruction data에 lamports 포함
 * 4. 여러 instruction을 하나의 TX에 넣을 수 있음 (atomic batch)
 */
import {
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { connection, loadKeypair, getBalance, explorerUrl } from "./common";

async function main() {
  console.log("=== Native SOL 전송 ===\n");

  const sender = loadKeypair("main-wallet");
  const receiver = loadKeypair("receiver");

  // 전송 전 잔액
  console.log("[전송 전 잔액]");
  console.log(`  보내는 지갑: ${await getBalance(sender.publicKey.toBase58())}`);
  console.log(`  받는 지갑:   ${await getBalance(receiver.publicKey.toBase58())}`);

  // --- SOL 전송 트랜잭션 구성 ---
  const transferAmount = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL

  console.log(`\n[전송] ${transferAmount / LAMPORTS_PER_SOL} SOL`);
  console.log(`  From: ${sender.publicKey.toBase58()}`);
  console.log(`  To:   ${receiver.publicKey.toBase58()}`);

  /**
   * Transaction 구조 분석:
   *
   * EVM에서는:
   *   { nonce: 0, to: "0x...", value: "100000000", gasLimit: 21000, ... }
   *
   * Solana에서는:
   *   Transaction {
   *     recentBlockhash: "...",        ← nonce 대신 (만료 타이머 역할)
   *     feePayer: sender.publicKey,    ← 첫 번째 서명자 = fee payer
   *     instructions: [{
   *       programId: SystemProgram,    ← 호출할 프로그램 (native 전송용)
   *       keys: [from, to],           ← 참여 계정들
   *       data: [transfer, amount]    ← 명령어 + 금액
   *     }]
   *   }
   */
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: receiver.publicKey,
      lamports: transferAmount,
    })
  );

  // --- 전송 및 확인 ---
  const signature = await sendAndConfirmTransaction(connection, transaction, [
    sender, // signers 배열: 첫 번째 = fee payer
  ]);

  console.log(`\n[결과]`);
  console.log(`  TX Signature: ${signature}`);
  console.log(`  Explorer: ${explorerUrl(signature)}`);

  // 전송 후 잔액
  console.log(`\n[전송 후 잔액]`);
  console.log(`  보내는 지갑: ${await getBalance(sender.publicKey.toBase58())}`);
  console.log(`  받는 지갑:   ${await getBalance(receiver.publicKey.toBase58())}`);

  // --- 트랜잭션 상세 분석 ---
  const txDetail = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (txDetail) {
    console.log(`\n[TX 상세 (EVM receipt 대응)]`);
    console.log(`  Slot: ${txDetail.slot}`);
    console.log(`  Block Time: ${new Date((txDetail.blockTime ?? 0) * 1000).toISOString()}`);
    console.log(`  Fee: ${txDetail.meta?.fee} lamports (${(txDetail.meta?.fee ?? 0) / LAMPORTS_PER_SOL} SOL)`);
    console.log(`  성공 여부: ${txDetail.meta?.err === null ? "성공" : "실패"}`);
    console.log(`  Compute Units 사용: ${txDetail.meta?.computeUnitsConsumed ?? "N/A"}`);

    // 잔액 변화 (= EVM event log 대신 사용하는 방식)
    console.log(`\n  [잔액 변화] (Solana의 transfer 감지 방식)`);
    const preBalances = txDetail.meta?.preBalances ?? [];
    const postBalances = txDetail.meta?.postBalances ?? [];
    const accounts = txDetail.transaction.message.staticAccountKeys;

    for (let i = 0; i < accounts.length; i++) {
      const diff = (postBalances[i] - preBalances[i]) / LAMPORTS_PER_SOL;
      if (diff !== 0) {
        console.log(`    ${accounts[i].toBase58().slice(0, 12)}...: ${diff > 0 ? "+" : ""}${diff.toFixed(9)} SOL`);
      }
    }
  }

  console.log("\n다음 단계: npm run 05 (SPL 토큰 전송)");
}

main().catch(console.error);

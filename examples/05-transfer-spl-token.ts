/**
 * 05. SPL Token 전송
 *
 * EVM과의 차이:
 * - EVM: ERC20.transfer(to, amount) → 컨트랙트 호출 1건
 * - Solana: Token Program.transfer(fromATA, toATA, owner, amount)
 *
 * 핵심 차이:
 * 1. 수신자에게 ATA가 없으면 전송 실패! (EVM에서는 항상 성공)
 * 2. ATA가 없으면 먼저 생성해야 함 (~0.00204 SOL 비용)
 * 3. from/to가 지갑 주소가 아니라 ATA 주소 (토큰 계정)
 * 4. ATA 생성 + 전송을 하나의 TX에 넣을 수 있음 (atomic)
 */
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { connection, loadKeypair, explorerUrl } from "./common";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("=== SPL Token 전송 (ERC20 transfer 대응) ===\n");

  const sender = loadKeypair("main-wallet");
  const receiver = loadKeypair("receiver");

  // Mint 주소 로드
  const mintStr = JSON.parse(
    fs.readFileSync(path.join(__dirname, ".keys", "token-mint.json"), "utf-8")
  );
  const mint = new PublicKey(mintStr);
  console.log(`Token Mint: ${mint.toBase58()}`);

  // --- 방법 1: 고수준 API (getOrCreateAssociatedTokenAccount 사용) ---
  console.log("\n[방법 1] 고수준 API - 자동 ATA 생성");
  console.log("  SDK가 ATA 존재 여부를 확인하고 없으면 자동 생성\n");

  // 보내는 쪽 ATA
  const senderAta = await getOrCreateAssociatedTokenAccount(
    connection, sender, mint, sender.publicKey
  );
  // 받는 쪽 ATA (없으면 sender가 비용 부담하여 생성)
  const receiverAta = await getOrCreateAssociatedTokenAccount(
    connection, sender, mint, receiver.publicKey
  );

  // 전송 전 잔액
  const senderBefore = await getAccount(connection, senderAta.address);
  const receiverBefore = await getAccount(connection, receiverAta.address);
  console.log(`[전송 전]`);
  console.log(`  보내는 쪽: ${Number(senderBefore.amount) / 1e6} tokens`);
  console.log(`  받는 쪽:   ${Number(receiverBefore.amount) / 1e6} tokens`);

  // 전송: 1,000 토큰
  const transferAmount = 1_000 * 10 ** 6; // decimals = 6
  console.log(`\n[전송] 1,000 tokens`);

  const sig1 = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createTransferInstruction(
        senderAta.address,    // from (ATA 주소, 지갑 주소 아님!)
        receiverAta.address,  // to (ATA 주소)
        sender.publicKey,     // owner (from ATA의 소유자)
        transferAmount
      )
    ),
    [sender]
  );

  const senderAfter = await getAccount(connection, senderAta.address);
  const receiverAfter = await getAccount(connection, receiverAta.address);
  console.log(`  TX: ${explorerUrl(sig1)}`);
  console.log(`\n[전송 후]`);
  console.log(`  보내는 쪽: ${Number(senderAfter.amount) / 1e6} tokens`);
  console.log(`  받는 쪽:   ${Number(receiverAfter.amount) / 1e6} tokens`);

  // --- 방법 2: 저수준 API (ATA 생성 + 전송을 하나의 TX로) ---
  console.log("\n\n[방법 2] 저수준 API - ATA 생성 + 전송을 단일 TX에 번들");
  console.log("  EVM에서는 불가능한 패턴: 두 개의 컨트랙트 호출을 atomic으로 묶기");
  console.log("  Solana에서는 여러 instruction을 하나의 TX에 넣을 수 있음\n");

  // 새 수신 지갑 생성 (ATA가 없는 상태)
  const { Keypair } = await import("@solana/web3.js");
  const newReceiver = Keypair.generate();
  const newReceiverAta = await getAssociatedTokenAddress(mint, newReceiver.publicKey);

  console.log(`  새 수신 지갑: ${newReceiver.publicKey.toBase58()}`);
  console.log(`  ATA (아직 생성 안 됨): ${newReceiverAta.toBase58()}`);

  // 하나의 TX에 2개 instruction: ATA 생성 + 토큰 전송
  const tx = new Transaction().add(
    // Instruction 1: ATA 생성 (Idempotent - 이미 있으면 무시)
    createAssociatedTokenAccountInstruction(
      sender.publicKey,       // payer (생성 비용 부담)
      newReceiverAta,         // 생성할 ATA 주소
      newReceiver.publicKey,  // ATA owner
      mint                    // token mint
    ),
    // Instruction 2: 토큰 전송
    createTransferInstruction(
      senderAta.address,      // from ATA
      newReceiverAta,         // to ATA (위에서 생성)
      sender.publicKey,       // owner
      500 * 10 ** 6           // 500 tokens
    )
  );

  const sig2 = await sendAndConfirmTransaction(connection, tx, [sender]);
  console.log(`  TX: ${explorerUrl(sig2)}`);

  const newReceiverBalance = await getAccount(connection, newReceiverAta);
  console.log(`  새 수신 지갑 잔액: ${Number(newReceiverBalance.amount) / 1e6} tokens`);
  console.log(`  ※ ATA 생성 + 전송이 하나의 atomic TX에서 처리됨`);

  console.log("\n다음 단계: npm run 06 (Fee Payer 지정)");
}

main().catch(console.error);

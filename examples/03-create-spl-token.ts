/**
 * 03. SPL Token 생성 및 민팅
 *
 * EVM과의 차이:
 * - EVM: ERC20 컨트랙트를 배포 (Solidity 코드 + constructor)
 * - Solana: Token Program이 이미 배포되어 있음. "Mint" 계정을 생성하면 토큰 발행 가능
 *
 * Solana 토큰 구조:
 *   Mint Account (= ERC20 contract address)
 *   ├── decimals, supply, mintAuthority
 *   └── Token Account (= 유저별 잔액 보관 계정)
 *       ├── Associated Token Account (ATA) - 유저당 1개 (결정적 주소)
 *       └── owner, amount, mint
 *
 * ATA (Associated Token Account):
 * - EVM에서는 어떤 주소든 ERC20을 받을 수 있지만
 * - Solana에서는 토큰별로 전용 계정(ATA)이 필요
 * - ATA 주소 = PDA(wallet, TOKEN_PROGRAM, mint) → 결정적 도출
 * - 생성 비용: ~0.00204 SOL (rent-exempt deposit, 계정 close 시 반환)
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { connection, loadKeypair, saveKeypair, explorerUrl } from "./common";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("=== SPL Token 생성 (ERC20 대응) ===\n");

  const mainWallet = loadKeypair("main-wallet");
  const receiver = loadKeypair("receiver");

  // --- 1. Mint 생성 (= ERC20 컨트랙트 배포에 해당) ---
  console.log("[1] Token Mint 생성");
  console.log("  EVM 대응: ERC20 컨트랙트 배포");
  console.log("  Solana: Token Program의 createMint 호출\n");

  const mint = await createMint(
    connection,
    mainWallet,          // payer (rent 비용 부담)
    mainWallet.publicKey, // mintAuthority (민팅 권한)
    null,                // freezeAuthority (null = 동결 불가)
    6                    // decimals (USDC와 동일)
  );

  console.log(`  Mint 주소: ${mint.toBase58()}`);
  console.log(`  Decimals: 6 (1 token = 1,000,000 최소 단위)`);
  console.log(`  MintAuthority: ${mainWallet.publicKey.toBase58()}`);

  // mint 주소 저장 (다른 예제에서 사용)
  const keysDir = path.join(__dirname, ".keys");
  fs.writeFileSync(
    path.join(keysDir, "token-mint.json"),
    JSON.stringify(mint.toBase58())
  );

  // --- 2. ATA 생성 (= ERC20 approve 없이 잔액 계정 준비) ---
  console.log("\n[2] Associated Token Account (ATA) 생성");
  console.log("  EVM 대응: 별도 작업 불필요 (ERC20은 주소만 있으면 수신 가능)");
  console.log("  Solana: 토큰별 전용 계정이 필요. 없으면 토큰 수신 불가!\n");

  // 메인 지갑의 ATA
  const mainAta = await getOrCreateAssociatedTokenAccount(
    connection,
    mainWallet,           // payer
    mint,                 // 어떤 토큰의 ATA인지
    mainWallet.publicKey  // owner (누구의 ATA인지)
  );
  console.log(`  메인 지갑 ATA: ${mainAta.address.toBase58()}`);
  console.log(`    owner: ${mainAta.owner.toBase58()}`);
  console.log(`    mint:  ${mint.toBase58()}`);

  // 수신 지갑의 ATA
  const receiverAta = await getOrCreateAssociatedTokenAccount(
    connection,
    mainWallet,          // payer (수신자 대신 생성 비용 부담 가능!)
    mint,
    receiver.publicKey   // owner
  );
  console.log(`\n  수신 지갑 ATA: ${receiverAta.address.toBase58()}`);
  console.log(`    owner: ${receiver.publicKey.toBase58()}`);
  console.log(`    ※ 생성 비용(~0.00204 SOL)은 mainWallet이 대납`);

  // --- 3. 토큰 민팅 (= ERC20 mint 함수 호출) ---
  console.log("\n[3] 토큰 민팅 (1,000,000 토큰)");
  console.log("  EVM 대응: ERC20.mint(to, amount)");

  const mintAmount = 1_000_000 * 10 ** 6; // 1M tokens * decimals

  const mintSig = await mintTo(
    connection,
    mainWallet,           // payer
    mint,                 // mint 주소
    mainAta.address,      // 민팅 받을 ATA
    mainWallet,           // mintAuthority
    mintAmount
  );
  console.log(`  TX: ${explorerUrl(mintSig)}`);

  // 잔액 확인
  const mintInfo = await getMint(connection, mint);
  const accountInfo = await getAccount(connection, mainAta.address);

  console.log(`\n[결과]`);
  console.log(`  총 공급량: ${Number(mintInfo.supply) / 10 ** 6} tokens`);
  console.log(`  메인 지갑 잔액: ${Number(accountInfo.amount) / 10 ** 6} tokens`);
  console.log(`  수신 지갑 잔액: 0 tokens (아직 전송 전)`);

  console.log("\n---");
  console.log("참고: 실제 devnet USDC를 받으려면");
  console.log("  Circle Faucet: https://faucet.circle.com/");
  console.log("  Devnet USDC Mint: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  console.log("\n다음 단계: npm run 04 (SOL 전송)");
}

main().catch(console.error);

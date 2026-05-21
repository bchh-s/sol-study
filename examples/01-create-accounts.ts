/**
 * 01. 솔라나 테스트넷 계정 만들기
 *
 * EVM과의 차이:
 * - EVM: secp256k1 개인키(32B) → ECDSA 공개키(64B) → keccak256 → 하위 20B = 주소
 * - Solana: Ed25519 개인키(32B) → 공개키(32B) = 주소 (base58 인코딩)
 *
 * Solana에서는 공개키 자체가 주소이므로 해싱 단계가 없다.
 * secretKey는 64바이트: [개인키(32B) + 공개키(32B)] 연결
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { saveKeypair, connection } from "./common";

async function main() {
  console.log("=== 솔라나 Devnet 계정 생성 ===\n");

  // --- 1. 메인 지갑 생성 ---
  const mainWallet = Keypair.generate();
  console.log("[메인 지갑]");
  console.log(`  주소 (PublicKey): ${mainWallet.publicKey.toBase58()}`);
  console.log(`  주소 길이: ${mainWallet.publicKey.toBase58().length}자 (EVM은 42자)`);
  console.log(`  secretKey 크기: ${mainWallet.secretKey.length}바이트 (개인키32 + 공개키32)`);
  console.log(`  base58 개인키: ${bs58.encode(mainWallet.secretKey).slice(0, 20)}...`);
  saveKeypair("main-wallet", mainWallet);

  // --- 2. 수신 지갑 생성 (전송 테스트용) ---
  const receiver = Keypair.generate();
  console.log("\n[수신 지갑]");
  console.log(`  주소 (PublicKey): ${receiver.publicKey.toBase58()}`);
  saveKeypair("receiver", receiver);

  // --- 3. Fee Payer 지갑 생성 (수수료 대납용) ---
  const feePayer = Keypair.generate();
  console.log("\n[Fee Payer 지갑]");
  console.log(`  주소 (PublicKey): ${feePayer.publicKey.toBase58()}`);
  saveKeypair("fee-payer", feePayer);

  // --- 4. 기본 정보 출력 ---
  const slot = await connection.getSlot();
  const blockHeight = await connection.getBlockHeight();
  console.log("\n[Devnet 상태]");
  console.log(`  현재 Slot: ${slot.toLocaleString()}`);
  console.log(`  Block Height: ${blockHeight.toLocaleString()}`);
  console.log(`  Slot ≠ Block Height (빈 슬롯이 있으므로)`);

  console.log("\n다음 단계: npm run 02 (SOL airdrop 받기)");
}

main().catch(console.error);

/**
 * 02. SOL Airdrop 받기 (Devnet Faucet)
 *
 * EVM과의 차이:
 * - EVM testnet: faucet 웹사이트에서 수동으로 받거나 별도 API 호출
 * - Solana devnet: RPC 메서드 `requestAirdrop`이 내장되어 있음
 *
 * 주의:
 * - devnet airdrop은 요청당 최대 2 SOL
 * - rate limit 있음 (연속 요청 시 실패 가능)
 * - 한 계정당 일정 시간 내 제한 존재
 */
import {
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { connection, loadKeypair, getBalance, explorerUrl, sleep } from "./common";

async function airdropSol(name: string, address: PublicKey, amount: number) {
  console.log(`\n[${name}] ${address.toBase58()}`);
  console.log(`  요청: ${amount} SOL airdrop...`);

  try {
    const signature = await connection.requestAirdrop(
      address,
      amount * LAMPORTS_PER_SOL
    );

    // 확인 대기 (confirmed commitment)
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });

    const balance = await getBalance(address.toBase58());
    console.log(`  성공! TX: ${explorerUrl(signature)}`);
    console.log(`  잔액: ${balance}`);
  } catch (err: any) {
    if (err.message?.includes("429")) {
      console.log(`  실패: Rate limit. 잠시 후 다시 시도하세요.`);
    } else {
      console.log(`  실패: ${err.message}`);
    }
  }
}

async function main() {
  console.log("=== SOL Airdrop (Devnet Faucet) ===");
  console.log("Solana devnet은 requestAirdrop RPC가 내장되어 있음 (EVM과 다른 점)");

  const mainWallet = loadKeypair("main-wallet");
  const feePayer = loadKeypair("fee-payer");
  const receiver = loadKeypair("receiver");

  // 메인 지갑에 2 SOL
  await airdropSol("메인 지갑", mainWallet.publicKey, 2);
  await sleep(1000); // rate limit 방지

  // Fee payer에 2 SOL
  await airdropSol("Fee Payer", feePayer.publicKey, 2);
  await sleep(1000);

  // Receiver에 0.1 SOL (rent-exempt 유지용 최소 잔액)
  await airdropSol("수신 지갑", receiver.publicKey, 0.5);

  console.log("\n---");
  console.log("참고: USDC/USDT devnet 토큰은 별도 faucet 필요");
  console.log("  - USDC (Circle devnet): https://faucet.circle.com/");
  console.log("  - 또는 다음 단계에서 자체 SPL 토큰을 만들어서 테스트");
  console.log("\n다음 단계: npm run 03 (SPL 토큰 생성 및 민팅)");
}

main().catch(console.error);

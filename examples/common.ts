/**
 * 공통 유틸리티
 * - devnet 연결
 * - 키페어 저장/로드
 */
import {
  Connection,
  Keypair,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Solana devnet 연결 (테스트넷)
export const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// 키 파일 저장 경로
const KEYS_DIR = path.join(__dirname, ".keys");

/**
 * 키페어를 파일로 저장
 * secretKey는 Uint8Array(64) = [privateKey(32) + publicKey(32)]
 */
export function saveKeypair(name: string, keypair: Keypair): void {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }
  const filePath = path.join(KEYS_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)));
  console.log(`  키 저장: ${filePath}`);
}

/**
 * 파일에서 키페어 로드
 */
export function loadKeypair(name: string): Keypair {
  const filePath = path.join(KEYS_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`키 파일 없음: ${filePath}\n  먼저 npm run 01 로 계정을 생성하세요.`);
  }
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(filePath, "utf-8")));
  return Keypair.fromSecretKey(secretKey);
}

/**
 * SOL 잔액 조회 (사람이 읽기 쉬운 형태)
 */
export async function getBalance(address: string): Promise<string> {
  const { PublicKey } = await import("@solana/web3.js");
  const balance = await connection.getBalance(new PublicKey(address));
  return `${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL`;
}

/**
 * TX 서명을 explorer 링크로 변환
 */
export function explorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

/**
 * 잠시 대기 (rate limit 방지)
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * KMS Ed25519 서명 데모
 * ─────────────────────
 *
 * AWS KMS를 사용한 Solana 트랜잭션 서명 워크플로우를 로컬에서 시뮬레이션한다.
 * 실제 KMS 호출 대신 로컬 Ed25519 키쌍을 사용하지만,
 * 각 단계가 실제 KMS 통합에서 어떤 API 호출에 대응하는지 주석으로 표시한다.
 *
 * 실행: npx ts-node key-signing-demo.ts
 */

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  Connection,
} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { createHash } from 'crypto';

// ─────────────────────────────────────────────────────────────
// 유틸리티 함수
// ─────────────────────────────────────────────────────────────

/** 바이트 배열을 hex 문자열로 변환 */
function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/** 구분선 출력 */
function divider(title: string): void {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70) + '\n');
}

// ─────────────────────────────────────────────────────────────
// 1단계: Ed25519 키쌍 생성 (KMS CreateKey 시뮬레이션)
// ─────────────────────────────────────────────────────────────

divider('1단계: Ed25519 키쌍 생성 (KMS CreateKey 시뮬레이션)');

/**
 * 실제 KMS에서는:
 *   const response = await kms.send(new CreateKeyCommand({
 *     KeySpec: 'ECC_NIST_EDWARDS25519',
 *     KeyUsage: 'SIGN_VERIFY',
 *   }));
 *   const keyId = response.KeyMetadata.KeyId;
 *
 * 로컬에서는 nacl로 키쌍을 직접 생성한다.
 * KMS에서는 private key가 HSM 안에만 존재하지만,
 * 로컬 시뮬레이션에서는 서명을 위해 private key에 접근한다.
 */
const keypair = nacl.sign.keyPair();
const privateKey = keypair.secretKey;  // 64바이트 (seed 32B + pubkey 32B) — KMS에서는 접근 불가
const publicKey = keypair.publicKey;   // 32바이트 raw Ed25519 공개키

console.log('Ed25519 키쌍 생성 완료');
console.log(`  개인키 크기: ${privateKey.length} bytes (seed 32B + pubkey 32B)`);
console.log(`  공개키 크기: ${publicKey.length} bytes`);
console.log(`  공개키 (hex): ${toHex(publicKey)}`);

// Solana SDK의 Keypair으로도 래핑 (편의를 위해)
const solanaKeypair = Keypair.fromSecretKey(privateKey);
console.log(`\n  Solana Keypair 공개키 일치 확인: ${solanaKeypair.publicKey.toBase58()}`);

// ─────────────────────────────────────────────────────────────
// 2단계: DER 인코딩된 공개키 시뮬레이션 (KMS GetPublicKey)
// ─────────────────────────────────────────────────────────────

divider('2단계: DER 공개키에서 raw 공개키 추출 (KMS GetPublicKey 시뮬레이션)');

/**
 * 실제 KMS에서는:
 *   const response = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }));
 *   const derPublicKey = response.PublicKey; // Uint8Array (DER 인코딩)
 *
 * KMS는 SubjectPublicKeyInfo (DER) 형식으로 공개키를 반환한다.
 * Ed25519의 DER 헤더는 12바이트로 고정이다:
 *   30 2A 30 05 06 03 2B 65 70 03 21 00
 *
 * 이 헤더의 의미:
 *   30 2A       — SEQUENCE (42바이트)
 *   30 05       — SEQUENCE (5바이트, AlgorithmIdentifier)
 *   06 03       — OID (3바이트)
 *   2B 65 70    — OID 값: 1.3.101.112 (Ed25519)
 *   03 21       — BIT STRING (33바이트)
 *   00          — 패딩 비트 수 (0)
 *   [32B 공개키]
 */

// Ed25519 DER 헤더 (12바이트 고정)
const ED25519_DER_HEADER = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

// DER 인코딩된 공개키 생성 (KMS 응답 시뮬레이션)
const derPublicKey = Buffer.concat([ED25519_DER_HEADER, publicKey]);
console.log(`DER 인코딩된 공개키 (${derPublicKey.length}바이트):`);
console.log(`  헤더 (12B): ${toHex(derPublicKey.slice(0, 12))}`);
console.log(`  공개키(32B): ${toHex(derPublicKey.slice(12))}`);

// DER에서 raw 공개키 추출
const extractedPublicKey = derPublicKey.slice(12);

// 헤더 검증 (프로덕션 코드에서 필수)
const headerMatch = derPublicKey.slice(0, 12).equals(ED25519_DER_HEADER);
console.log(`\n  DER 헤더 검증: ${headerMatch ? 'PASS' : 'FAIL'}`);
console.log(`  추출된 공개키 == 원본 공개키: ${Buffer.from(extractedPublicKey).equals(Buffer.from(publicKey))}`);

// ─────────────────────────────────────────────────────────────
// 3단계: Base58 주소 도출
// ─────────────────────────────────────────────────────────────

divider('3단계: Base58 주소 도출');

/**
 * Solana 주소 = base58(raw 32-byte Ed25519 공개키)
 *
 * EVM과 달리 해싱 과정이 없다:
 *   EVM:    pubkey → keccak256 → 하위 20B → hex → 0x742d35...
 *   Solana: pubkey → base58 → 7xKXtg2C...
 *
 * 주소가 곧 공개키이므로, 주소만으로 서명 검증이 가능하다.
 */

const solanaAddress = bs58.encode(extractedPublicKey);
console.log(`raw 공개키 (32B hex): ${toHex(extractedPublicKey)}`);
console.log(`Solana 주소 (base58): ${solanaAddress}`);
console.log(`주소 길이: ${solanaAddress.length}자`);

// PublicKey 객체로 변환하여 검증
const solanaPubkey = new PublicKey(extractedPublicKey);
console.log(`\nPublicKey.toBase58(): ${solanaPubkey.toBase58()}`);
console.log(`직접 인코딩과 일치: ${solanaPubkey.toBase58() === solanaAddress}`);

// On curve 검증 (유효한 Ed25519 포인트인지 확인)
console.log(`Ed25519 곡선 위의 점: ${PublicKey.isOnCurve(extractedPublicKey)}`);

// ─────────────────────────────────────────────────────────────
// 4단계: SOL 전송 트랜잭션 생성 및 메시지 직렬화
// ─────────────────────────────────────────────────────────────

divider('4단계: SOL 전송 트랜잭션 생성');

/**
 * Solana 트랜잭션 메시지 구조:
 *   - Header: 서명 수, 읽기 전용 계정 수
 *   - Account addresses: 참여 계정 목록
 *   - Recent blockhash: 트랜잭션 유효 기간
 *   - Instructions: 실행할 명령어들
 *
 * 이 메시지가 직렬화되어 서명 대상이 된다.
 * EVM과 달리 해싱 없이 원본 바이트를 서명한다.
 */

// 수신자 주소 (임의 생성)
const recipient = Keypair.generate().publicKey;

// 더미 blockhash (실제로는 connection.getLatestBlockhash()로 가져옴)
// base58 인코딩된 32바이트 해시를 사용
const dummyBlockhash = bs58.encode(Buffer.alloc(32, 0xab));

const transaction = new Transaction();
transaction.recentBlockhash = dummyBlockhash;
transaction.feePayer = solanaPubkey;

// SOL 전송 instruction 추가 (0.1 SOL)
transaction.add(
  SystemProgram.transfer({
    fromPubkey: solanaPubkey,
    toPubkey: recipient,
    lamports: 0.1 * LAMPORTS_PER_SOL, // 100,000,000 lamports
  })
);

// 메시지 직렬화 — 이것이 KMS Sign에 전달할 데이터
const message = transaction.compileMessage();
const serializedMessage = message.serialize();

console.log('트랜잭션 구성:');
console.log(`  발신자: ${solanaPubkey.toBase58()}`);
console.log(`  수신자: ${recipient.toBase58()}`);
console.log(`  금액: 0.1 SOL (${0.1 * LAMPORTS_PER_SOL} lamports)`);
console.log(`  Blockhash: ${dummyBlockhash}`);
console.log(`\n직렬화된 메시지:`);
console.log(`  크기: ${serializedMessage.length} bytes`);
console.log(`  hex: ${toHex(serializedMessage).substring(0, 80)}...`);

// ─────────────────────────────────────────────────────────────
// 5단계: Ed25519 서명 (KMS Sign 시뮬레이션)
// ─────────────────────────────────────────────────────────────

divider('5단계: Ed25519 서명 (KMS Sign 시뮬레이션)');

/**
 * 실제 KMS에서는:
 *   const response = await kms.send(new SignCommand({
 *     KeyId: keyId,
 *     Message: serializedMessage,              // ← 원본 바이트 (해시 아님!)
 *     MessageType: 'RAW',                      // ← 중요: DIGEST가 아닌 RAW
 *     SigningAlgorithm: 'EDDSA_ED25519_SHA_512',
 *   }));
 *   const signature = response.Signature; // 64바이트
 *
 * RAW를 사용하는 이유:
 *   Ed25519는 서명 과정에서 내부적으로 SHA-512 해싱을 수행한다.
 *   외부에서 먼저 해시하면 이중 해싱이 되어 검증 실패.
 *   반드시 원본 메시지를 전달해야 한다.
 *
 * KMS는 64바이트 raw 서명을 반환한다 (R 32B + S 32B).
 * ECDSA와 달리 DER 인코딩이 아니므로 파싱이 불필요하다.
 */

// nacl.sign.detached: 메시지에 대한 분리된 서명 생성 (KMS Sign 시뮬레이션)
const signature = nacl.sign.detached(serializedMessage, privateKey);

console.log('서명 결과:');
console.log(`  서명 크기: ${signature.length} bytes`);
console.log(`  R (32B): ${toHex(signature.slice(0, 32))}`);
console.log(`  S (32B): ${toHex(signature.slice(32))}`);
console.log(`  전체 (hex): ${toHex(signature)}`);

// Ed25519 서명의 결정적 특성 확인: 같은 메시지에 같은 서명
const signature2 = nacl.sign.detached(serializedMessage, privateKey);
const isDeterministic = Buffer.from(signature).equals(Buffer.from(signature2));
console.log(`\n  결정적 서명 확인 (같은 입력 → 같은 출력): ${isDeterministic}`);
console.log('  (ECDSA는 매번 다른 서명을 생성하지만, EdDSA는 항상 동일)');

// ─────────────────────────────────────────────────────────────
// 6단계: 서명 검증
// ─────────────────────────────────────────────────────────────

divider('6단계: 서명 검증');

/**
 * 검증 방법 1: nacl.sign.detached.verify
 *   공개키와 원본 메시지, 서명으로 검증한다.
 *   Solana 네트워크의 validator가 내부적으로 수행하는 것과 동일한 연산.
 *
 * 검증 방법 2: Solana SDK의 Transaction.verifySignatures
 *   서명이 트랜잭션에 올바르게 추가되었는지 확인한다.
 *
 * Dagaon Core에서는 KMS 서명 후 즉시 로컬 검증을 수행하여
 * 네트워크에 전송하기 전에 서명 유효성을 확인하는 것이 권장된다.
 */

// 방법 1: nacl로 직접 검증
const isValid = nacl.sign.detached.verify(serializedMessage, signature, publicKey);
console.log(`nacl.sign.detached.verify: ${isValid ? 'PASS' : 'FAIL'}`);

// 잘못된 메시지로 검증 (실패 케이스)
const tamperedMessage = new Uint8Array(serializedMessage);
tamperedMessage[0] = tamperedMessage[0] ^ 0xff; // 첫 바이트 변조
const isInvalid = nacl.sign.detached.verify(tamperedMessage, signature, publicKey);
console.log(`변조된 메시지 검증: ${isInvalid ? 'FAIL (잘못됨!)' : 'FAIL (정상 -- 변조 감지)'}`);

// 잘못된 키로 검증 (실패 케이스)
const wrongKeypair = nacl.sign.keyPair();
const wrongKeyVerify = nacl.sign.detached.verify(serializedMessage, signature, wrongKeypair.publicKey);
console.log(`잘못된 키로 검증: ${wrongKeyVerify ? 'FAIL (잘못됨!)' : 'FAIL (정상 -- 키 불일치 감지)'}`);

// 방법 2: 트랜잭션에 서명 추가 후 SDK로 검증
transaction.addSignature(solanaPubkey, Buffer.from(signature));
const txVerified = transaction.verifySignatures();
console.log(`\nTransaction.verifySignatures(): ${txVerified ? 'PASS' : 'FAIL'}`);

// 서명된 트랜잭션 바이트 확인
const signedTxBytes = transaction.serialize();
console.log(`\n서명된 트랜잭션:`);
console.log(`  전체 크기: ${signedTxBytes.length} bytes`);
console.log(`  구조: [서명 수(1B)] + [서명(64B)] + [메시지(${serializedMessage.length}B)]`);

// ─────────────────────────────────────────────────────────────
// 7단계: EVM 서명 워크플로우와 비교
// ─────────────────────────────────────────────────────────────

divider('7단계: EVM vs Solana 서명 워크플로우 비교');

/**
 * EVM 서명 흐름:
 *   1. unsigned TX 생성 (to, value, gas, nonce, data, chainId)
 *   2. RLP 인코딩 → 가변 길이 바이트
 *   3. keccak256 해싱 → 32바이트 다이제스트 ★
 *   4. KMS Sign(hash, DIGEST, ECDSA_SHA_256) → DER(r, s)
 *   5. DER 파싱 → r(32B), s(32B)
 *   6. s 정규화 (EIP-2: low-s)
 *   7. recovery id → v 계산
 *   8. signed TX = RLP(tx + v, r, s)
 *
 * Solana 서명 흐름:
 *   1. Transaction message 빌드 (instructions, accounts, blockhash)
 *   2. message 직렬화 → 가변 길이 바이트
 *   3. (해싱 없음!) ★
 *   4. KMS Sign(raw_message, RAW, EDDSA_ED25519_SHA_512) → 64B 서명
 *   5. (DER 파싱 불필요!)
 *   6. (s 정규화 불필요!)
 *   7. (v 계산 불필요!)
 *   8. signed TX = [signatures] + [message]
 */

console.log('┌────────────────────────┬──────────────────────────────────────┐');
console.log('│ 비교 항목               │ EVM (secp256k1)  vs  Solana (Ed25519)│');
console.log('├────────────────────────┼──────────────────────────────────────┤');
console.log('│ KMS KeySpec            │ ECC_SECG_P256K1  vs  ECC_NIST_ED25519│');
console.log('│ Signing Algorithm      │ ECDSA_SHA_256    vs  EDDSA_ED25519   │');
console.log('│ MessageType            │ DIGEST           vs  RAW             │');
console.log('│ KMS 입력               │ 32B 해시          vs  원본 메시지 바이트│');
console.log('│ KMS 출력               │ DER(r,s) 가변     vs  64B raw 고정    │');
console.log('│ 서명 후처리             │ DER파싱+v계산+s정규│  없음             │');
console.log('│ 서명 결정성             │ 비결정적(랜덤nonce)│  결정적           │');
console.log('│ 서명 크기               │ 65 bytes (r,s,v) │  64 bytes (R,S)  │');
console.log('│ 주소 = 공개키?          │ 아니요 (해시)     │  예               │');
console.log('└────────────────────────┴──────────────────────────────────────┘');

// EVM 스타일 해싱 시뮬레이션 (keccak256 대신 SHA-256 사용 -- 비교 목적)
console.log('\n--- EVM 스타일 (해시 후 서명) 시뮬레이션 ---');
const sha256Hash = createHash('sha256').update(serializedMessage).digest();
console.log(`원본 메시지: ${serializedMessage.length} bytes`);
console.log(`SHA-256 해시: ${toHex(sha256Hash)} (32 bytes)`);
console.log(`→ EVM은 이 32바이트 해시를 KMS에 DIGEST로 전달`);
console.log(`→ Solana는 원본 ${serializedMessage.length}바이트를 KMS에 RAW로 전달`);

console.log('\n--- Solana 스타일 (원본 메시지 서명) ---');
console.log(`원본 메시지 → KMS Sign(RAW) → 64B 서명`);
console.log(`Ed25519가 내부적으로 SHA-512 해싱을 수행하므로 외부 해싱 불필요`);
console.log(`외부에서 해시하면 이중 해싱이 되어 서명 검증 실패!`);

// ─────────────────────────────────────────────────────────────
// 보너스: DER 서명 vs Raw 서명 비교
// ─────────────────────────────────────────────────────────────

divider('보너스: ECDSA DER 서명 vs EdDSA Raw 서명');

/**
 * ECDSA (EVM용)에서 KMS는 DER 인코딩된 서명을 반환한다.
 * 이를 파싱하여 r, s를 추출해야 한다.
 *
 * DER 서명 구조:
 *   30 <len> 02 <r_len> <r> 02 <s_len> <s>
 *   - 30: SEQUENCE 태그
 *   - 02: INTEGER 태그
 *   - r_len/s_len: 32 또는 33 (MSB가 1이면 0x00 선행)
 *   - 총 길이: 70~72바이트 (가변)
 *
 * EdDSA (Solana용)에서 KMS는 64바이트 raw 서명을 반환한다.
 *   R (32B) + S (32B) = 64B (고정)
 *   파싱 불필요!
 */

// 예시: DER 인코딩된 ECDSA 서명 구조 (가상)
const exampleDerSignature = Buffer.from([
  0x30, 0x44,                                           // SEQUENCE, 68바이트
  0x02, 0x20,                                           // INTEGER, r (32바이트)
  ...Array(32).fill(0xaa),                              // r 값
  0x02, 0x20,                                           // INTEGER, s (32바이트)
  ...Array(32).fill(0xbb),                              // s 값
]);

console.log('ECDSA DER 서명 (EVM):');
console.log(`  전체 크기: ${exampleDerSignature.length} bytes (가변: 70~72)`);
console.log(`  구조: 30 ${exampleDerSignature[1].toString(16)} 02 20 [r:32B] 02 20 [s:32B]`);
console.log(`  파싱 필요: DER → r, s 추출 → v 계산 → s 정규화`);

console.log('\nEdDSA Raw 서명 (Solana):');
console.log(`  전체 크기: ${signature.length} bytes (항상 64 고정)`);
console.log(`  구조: R(32B) + S(32B)`);
console.log(`  파싱 필요: 없음. 그대로 트랜잭션에 첨부.`);

// ─────────────────────────────────────────────────────────────
// 요약
// ─────────────────────────────────────────────────────────────

divider('요약: Dagaon Core KMS 통합 시 핵심 포인트');

console.log('1. AWS KMS CreateKey 시 KeySpec만 변경:');
console.log('   EVM:    ECC_SECG_P256K1');
console.log('   Solana: ECC_NIST_EDWARDS25519');

console.log('\n2. GetPublicKey → 주소 도출:');
console.log('   EVM:    DER(88B) → slice(24) → 64B → keccak256 → 20B → hex');
console.log('   Solana: DER(44B) → slice(12) → 32B → base58 = 주소');

console.log('\n3. Sign API 호출:');
console.log('   EVM:    Message=keccak256(RLP(tx)), Type=DIGEST, Algo=ECDSA_SHA_256');
console.log('   Solana: Message=serialize(msg),     Type=RAW,    Algo=EDDSA_ED25519_SHA_512');

console.log('\n4. 서명 후처리:');
console.log('   EVM:    DER 파싱 → r,s 추출 → s 정규화 → v 계산 → RLP(signed tx)');
console.log('   Solana: 64B 서명을 그대로 트랜잭션 앞에 붙이면 끝');

console.log('\n5. 동일 KMS 인스턴스에서 두 키 타입을 동시에 관리할 수 있다.');
console.log('   인프라 변경 없이 Dagaon Core의 signer 모듈만 확장하면 된다.');

console.log('\n데모 완료!\n');

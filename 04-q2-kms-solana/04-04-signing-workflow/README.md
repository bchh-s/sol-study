# 4.4 서명 워크플로우 비교

상위 섹션: [4. Q2: KMS Solana 지원 가능 여부](../README.md)

---

## 요약

EVM과 Solana의 트랜잭션 서명 워크플로우를 단계별로 비교한다.
가장 큰 차이는 KMS에 보내는 데이터가 **해시**(EVM)인지 **원본 메시지**(Solana)인지이다.

---

## 전체 흐름 비교 다이어그램

```
                    EVM 서명 흐름                         Solana 서명 흐름
                    ─────────────                         ──────────────────

          ┌─────────────────────┐              ┌──────────────────────────┐
          │ 1. Unsigned TX 생성  │              │ 1. Transaction Message    │
          │    (to, value, gas,  │              │    빌드 (instructions,    │
          │     nonce, data)     │              │    accounts, blockhash)   │
          └──────────┬──────────┘              └────────────┬─────────────┘
                     │                                      │
                     ▼                                      ▼
          ┌─────────────────────┐              ┌──────────────────────────┐
          │ 2. RLP 인코딩        │              │ 2. Message 직렬화         │
          │    (바이트 직렬화)    │              │    (Solana 바이너리 포맷)  │
          └──────────┬──────────┘              └────────────┬─────────────┘
                     │                                      │
                     ▼                                      │
          ┌─────────────────────┐                           │
          │ 3. keccak256 해싱    │                           │
          │    → 32바이트 다이제스│                           │
          │    트                │                           │
          └──────────┬──────────┘                           │
                     │                                      │
                     ▼                                      ▼
          ┌─────────────────────┐              ┌──────────────────────────┐
          │ 4. KMS Sign          │              │ 3. KMS Sign               │
          │    Message: 해시     │              │    Message: 원본 바이트    │
          │    Type: DIGEST      │              │    Type: RAW              │
          │    Algo: ECDSA_256   │              │    Algo: EDDSA_ED25519    │
          └──────────┬──────────┘              └────────────┬─────────────┘
                     │                                      │
                     ▼                                      ▼
          ┌─────────────────────┐              ┌──────────────────────────┐
          │ 5. DER 서명 파싱      │              │ 4. 64바이트 서명 수신      │
          │    → r(32B), s(32B)  │              │    (파싱 불필요)           │
          │    → v 계산 (27/28)  │              │                          │
          └──────────┬──────────┘              └────────────┬─────────────┘
                     │                                      │
                     ▼                                      ▼
          ┌─────────────────────┐              ┌──────────────────────────┐
          │ 6. Signed TX = RLP   │              │ 5. Signed TX =            │
          │    (tx + v,r,s)      │              │    [서명 배열] + [message] │
          └─────────────────────┘              └──────────────────────────┘
```

---

## EVM 서명 흐름 상세

### 단계 1: Unsigned Transaction 생성

```typescript
// EVM 트랜잭션 구성 요소
const tx = {
  nonce: 42,                          // 발신자의 트랜잭션 순서 번호
  gasPrice: 20_000_000_000n,          // 가스 가격 (wei)
  gasLimit: 21_000n,                  // 가스 한도
  to: '0x742d35Cc6634...',            // 수신자 주소
  value: 1_000_000_000_000_000_000n,  // 전송량 (wei, = 1 ETH)
  data: '0x',                         // 호출 데이터 (단순 전송은 비어있음)
  chainId: 1,                         // 메인넷=1, 서명 replay 방지
};
```

### 단계 2: RLP (Recursive Length Prefix) 인코딩

```
RLP은 Ethereum이 사용하는 직렬화 형식이다.
중첩된 리스트와 바이트 문자열을 효율적으로 인코딩한다.

인코딩 과정:
tx 객체 → [nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0]
        → RLP 바이트 직렬화

EIP-155 (replay protection):
- chainId, 0, 0을 추가하여 RLP 인코딩
- 이렇게 해야 다른 EVM 체인에서 서명을 재사용할 수 없음

결과: 가변 길이 바이트 배열 (수십~수백 바이트)
```

### 단계 3: keccak256 해싱

```
RLP 바이트를 keccak256으로 해싱하여 32바이트 다이제스트를 생성한다.

keccak256 ≠ SHA-3:
- Ethereum이 채택했을 때는 아직 SHA-3 표준 확정 전이었다
- NIST가 최종 SHA-3를 확정할 때 패딩을 변경했다
- 따라서 keccak256과 SHA3-256은 다른 해시를 생성한다

왜 해싱하는가?
- ECDSA 서명 입력은 고정 크기여야 한다
- 가변 길이 메시지를 32바이트로 압축
- KMS의 ECDSA_SHA_256에 DIGEST로 전달하면 추가 해싱 없이 이 32바이트에 직접 서명
```

### 단계 4: KMS Sign (ECDSA, DIGEST)

```typescript
const signResponse = await kms.send(new SignCommand({
  KeyId: evmKeyId,
  Message: keccak256Hash,            // ← 32바이트 해시
  MessageType: 'DIGEST',             // ← "이미 해시됨"
  SigningAlgorithm: 'ECDSA_SHA_256', // ← ECDSA with SHA-256
}));
```

KMS 내부 동작:
```
1. MessageType=DIGEST이므로 입력을 해싱하지 않는다
2. 입력 32바이트를 그대로 ECDSA 서명 알고리즘에 전달
3. KMS 내부의 HSM에서 private key로 서명 생성
4. DER 인코딩된 (r, s)를 반환
```

### 단계 5: DER 서명 파싱 + v 계산

```
KMS 반환값 (DER 인코딩):
30 44 02 20 [r: 32bytes] 02 20 [s: 32bytes]
     │
     ▼
파싱 후: r(32B), s(32B)

DER ECDSA 서명 구조:
30       - SEQUENCE 태그
44       - 길이 (68바이트, 가변)
02       - INTEGER 태그 (r)
20       - r의 길이 (32바이트, 가변: 선행 0이 있으면 33)
[r]      - r 값
02       - INTEGER 태그 (s)
20       - s의 길이 (32바이트, 가변)
[s]      - s 값

주의: DER INTEGER는 MSB가 1이면 양수 표시를 위해 0x00을 선행한다.
따라서 r이나 s의 길이가 33이 될 수 있다.

v (recovery id) 계산:
- 서명 (r, s)와 원본 해시로부터 두 개의 후보 공개키를 복원할 수 있다
- 실제 공개키와 일치하는 쪽의 인덱스가 v (0 또는 1)
- EVM에서는 v = 27 + recoveryId (EIP-155에서는 chainId*2 + 35 + recoveryId)
- KMS는 v를 제공하지 않으므로 애플리케이션에서 계산해야 한다

s 값 정규화 (EIP-2):
- s > secp256k1_order / 2 이면 s = order - s 로 변환
- 이른바 "low-s" 규칙
- 트랜잭션 malleability 방지 목적
```

### 단계 6: Signed Transaction 생성

```
signed TX = RLP([nonce, gasPrice, gasLimit, to, value, data, v, r, s])

EIP-155 적용:
v = chainId * 2 + 35 + recoveryId

signed TX 바이트를 hex로 인코딩하여 eth_sendRawTransaction RPC로 전송한다.
```

---

## Solana 서명 흐름 상세

### 단계 1: Transaction Message 빌드

```typescript
import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const transaction = new Transaction();

// 최근 blockhash 설정 (트랜잭션 유효 기간 결정)
transaction.recentBlockhash = blockhash;

// fee payer 설정
transaction.feePayer = fromPubkey;

// 전송 instruction 추가
transaction.add(
  SystemProgram.transfer({
    fromPubkey: fromPubkey,
    toPubkey: toPubkey,
    lamports: 0.1 * LAMPORTS_PER_SOL,
  })
);
```

### Solana Transaction Message 구조

```
Transaction Message 바이너리 레이아웃:
┌─────────────────────────────────────────────┐
│ Header (3 bytes)                             │
│   - num_required_signatures (1B)             │
│   - num_readonly_signed_accounts (1B)        │
│   - num_readonly_unsigned_accounts (1B)      │
├─────────────────────────────────────────────┤
│ Account Addresses (32B * N)                  │
│   - fee payer (항상 첫 번째)                   │
│   - 기타 참여 계정들                            │
├─────────────────────────────────────────────┤
│ Recent Blockhash (32B)                       │
├─────────────────────────────────────────────┤
│ Instructions                                 │
│   - program_id_index (1B)                    │
│   - account_indexes (compact-u16 + bytes)    │
│   - data (compact-u16 + bytes)               │
│   (instruction 수만큼 반복)                    │
└─────────────────────────────────────────────┘
```

### 단계 2: Message 직렬화

```typescript
// 트랜잭션 메시지를 바이트로 직렬화
const message = transaction.compileMessage();
const serializedMessage = message.serialize();
// 결과: Uint8Array (가변 길이, 보통 수십~수백 바이트)
```

**여기서 해싱하지 않는다!** 이것이 EVM과의 핵심 차이이다.

### 왜 해싱하지 않는가?

```
Ed25519 서명 알고리즘 (RFC 8032) 내부 동작:

1. 개인키 seed로부터 (a, prefix) = SHA-512(seed) 계산
2. 결정적 nonce: r = SHA-512(prefix || message) ← message를 직접 해시
3. R = r * B (곡선 위 점)
4. k = SHA-512(R || publicKey || message) ← 다시 message를 해시
5. S = (r + k * a) mod l
6. 서명 = (R, S)

보다시피, Ed25519는 서명 과정에서 message를 내부적으로 SHA-512에 입력한다.
만약 외부에서 먼저 해시를 하면:

외부 해시 후 전달 시:
r = SHA-512(prefix || SHA-512(message))  ← 이중 해싱!
k = SHA-512(R || publicKey || SHA-512(message))

Solana 검증자는 원본 message로 검증한다:
r' = SHA-512(prefix || message)
k' = SHA-512(R || publicKey || message)

r ≠ r', k ≠ k' → 서명 검증 실패!

따라서 반드시 원본 메시지 바이트를 KMS에 전달해야 한다.
```

### 단계 3: KMS Sign (EdDSA, RAW)

```typescript
const signResponse = await kms.send(new SignCommand({
  KeyId: solanaKeyId,
  Message: serializedMessage,              // ← 원본 메시지 바이트
  MessageType: 'RAW',                      // ← "해시하지 않은 원본"
  SigningAlgorithm: 'EDDSA_ED25519_SHA_512', // ← EdDSA with SHA-512
}));
```

KMS 내부 동작:
```
1. MessageType=RAW이므로 입력을 원본 메시지로 처리
2. Ed25519 서명 알고리즘 실행 (내부에서 SHA-512 해싱 포함)
3. 64바이트 raw 서명 (R 32B + S 32B) 반환
4. DER 인코딩 없음! (ECDSA와 다른 점)
```

### 단계 4: 64바이트 서명 수신

```typescript
const signature = signResponse.Signature!; // Uint8Array, 64 bytes
// DER 파싱 불필요! 그대로 사용할 수 있다.

// 검증: 길이가 64바이트인지 확인
if (signature.length !== 64) {
  throw new Error(`Expected 64 bytes, got ${signature.length}`);
}
```

EVM과 달리:
- DER 파싱이 필요 없다
- r, s 분리가 필요 없다
- v (recovery id) 계산이 필요 없다
- s 값 정규화가 필요 없다

### 단계 5: Signed Transaction 조립

```
Solana Signed Transaction 바이너리 레이아웃:
┌─────────────────────────────────────────────┐
│ Signature Count (compact-u16)                │
│   예: 01 (서명 1개)                           │
├─────────────────────────────────────────────┤
│ Signatures (64B * N)                         │
│   서명 배열 (fee payer 서명이 첫 번째)          │
├─────────────────────────────────────────────┤
│ Message (위에서 직렬화한 것 그대로)              │
└─────────────────────────────────────────────┘
```

```typescript
// 서명을 트랜잭션에 추가
transaction.addSignature(fromPubkey, Buffer.from(signature));

// 또는 수동으로 조립
const signedTx = Buffer.concat([
  Buffer.from([0x01]),            // 서명 개수 (1개)
  Buffer.from(signature),         // 64바이트 서명
  Buffer.from(serializedMessage), // 메시지 원본
]);

// sendRawTransaction으로 전송
const txHash = await connection.sendRawTransaction(signedTx);
```

---

## 핵심 차이 정리

| 단계 | EVM | Solana |
|------|-----|--------|
| 직렬화 | RLP 인코딩 | Solana 바이너리 포맷 |
| 해싱 | keccak256 (외부) | SHA-512 (Ed25519 내부) |
| KMS 입력 | 32B 해시 | 가변 길이 원본 메시지 |
| MessageType | DIGEST | RAW |
| KMS 출력 | DER (r,s) 가변 길이 | 64B raw (R,S) 고정 |
| 후처리 | DER 파싱 + v 계산 + s 정규화 | 없음 |
| 최종 TX | RLP(tx + v,r,s) | signatures + message |

### Solana가 더 단순한 이유

```
EVM 서명 후처리:
1. DER 바이트에서 r, s 추출 (ASN.1 파싱)
2. s > order/2 이면 정규화 (EIP-2)
3. recovery id 계산 (두 후보 중 올바른 것 탐색)
4. EIP-155 v 값 계산
5. signed TX 재직렬화 (RLP)

Solana 서명 후처리:
1. 64바이트 서명을 트랜잭션에 붙인다
(끝)

→ Solana signer 모듈의 구현이 EVM보다 훨씬 단순하다.
→ 서명 관련 버그 발생 확률이 낮다.
→ DER 파싱 라이브러리 의존성이 불필요하다.
```

---

## KMS 호출 크기 제한

```
AWS KMS Sign API의 Message 크기 제한:
- MessageType=DIGEST: 최대 4,096 바이트
- MessageType=RAW: 최대 4,096 바이트

EVM:
- keccak256 해시는 항상 32바이트 → 제한에 걸리지 않음

Solana:
- 직렬화된 메시지 크기는 트랜잭션 복잡도에 따라 다름
- 단순 SOL 전송: ~100바이트
- 복잡한 DeFi 트랜잭션: ~1,200바이트
- Solana 트랜잭션 크기 상한: 1,232바이트 (MTU 기반)

결론: Solana 트랜잭션의 최대 크기(1,232B)가 KMS 제한(4,096B)보다 작으므로,
      어떤 Solana 트랜잭션이든 RAW로 KMS에 전달할 수 있다.
```

---

## Dagaon Core Signer 모듈 구현 비교

### EVM Signer (현재 구현)

```typescript
class EvmSigner {
  async signTransaction(unsignedTx: EvmTransaction): Promise<string> {
    // 1. RLP 인코딩
    const rlpBytes = rlpEncode(unsignedTx);
    
    // 2. keccak256 해싱
    const hash = keccak256(rlpBytes);
    
    // 3. KMS 서명
    const kmsResponse = await this.kms.sign({
      KeyId: this.keyId,
      Message: hash,
      MessageType: 'DIGEST',
      SigningAlgorithm: 'ECDSA_SHA_256',
    });
    
    // 4. DER → r, s 파싱
    const { r, s } = parseDerSignature(kmsResponse.Signature!);
    
    // 5. s 정규화 (low-s)
    const normalizedS = normalizeS(s);
    
    // 6. recovery id → v 계산
    const v = calculateV(hash, r, normalizedS, this.publicKey, unsignedTx.chainId);
    
    // 7. signed TX 생성
    return rlpEncode({ ...unsignedTx, v, r, s: normalizedS });
  }
}
```

### Solana Signer (신규 구현)

```typescript
class SolanaSigner {
  async signTransaction(transaction: Transaction): Promise<Buffer> {
    // 1. 메시지 직렬화
    const message = transaction.compileMessage();
    const serializedMessage = message.serialize();
    
    // 2. KMS 서명 (해싱 없이 바로)
    const kmsResponse = await this.kms.sign({
      KeyId: this.keyId,
      Message: serializedMessage,
      MessageType: 'RAW',
      SigningAlgorithm: 'EDDSA_ED25519_SHA_512',
    });
    
    // 3. 서명 첨부 (후처리 없이 바로)
    const signature = kmsResponse.Signature!; // 64 bytes
    transaction.addSignature(this.publicKey, Buffer.from(signature));
    
    return transaction.serialize();
  }
}
```

구현 복잡도 차이가 명확하다:
- EVM: 7단계, DER 파싱 + s 정규화 + v 계산이라는 까다로운 로직 포함
- Solana: 3단계, 후처리가 없어서 버그 발생 표면이 작음

---

## 에러 처리 비교

### EVM에서 발생할 수 있는 서명 에러

```
1. DER 파싱 실패 (잘못된 DER 구조)
2. s 값이 order의 절반을 초과 (정규화 필요)
3. v 계산 실패 (두 후보 모두 불일치 -- KMS 키 불일치)
4. RLP 재인코딩 시 BigInt 오버플로우
5. chainId 불일치로 인한 v 값 오류
```

### Solana에서 발생할 수 있는 서명 에러

```
1. 서명 길이가 64바이트가 아님 (KMS 응답 이상)
2. 서명 검증 실패 (키 불일치 또는 메시지 변조)
3. blockhash 만료 (서명은 성공했지만 제출이 늦어짐)
```

Solana의 에러 케이스가 더 적고 단순하다.

## 참고

- [RFC 8032: EdDSA Signing](https://datatracker.ietf.org/doc/html/rfc8032#section-5.1.6)
- [Ethereum Yellow Paper: Transaction Signing](https://ethereum.github.io/yellowpaper/paper.pdf)
- [EIP-155: Simple Replay Attack Protection](https://eips.ethereum.org/EIPS/eip-155)
- [EIP-2: Homestead Hard-fork Changes (low-s)](https://eips.ethereum.org/EIPS/eip-2)
- [Solana Transaction Format](https://solana.com/docs/core/transactions)

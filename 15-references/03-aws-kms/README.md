# AWS KMS

상위 섹션: [15. 참고자료](../README.md)

---

## AWS KMS Ed25519 지원 발표

### 발표 내용

- **URL:** https://aws.amazon.com/about-aws/whats-new/2025/11/aws-kms-edwards-curve-digital-signature-algorithm/
- **발표일:** 2025년 11월
- **상태:** GA (General Availability) -- 프리뷰가 아닌 정식 출시
- **핵심 내용:**
  - AWS KMS에서 Edwards Curve(Ed25519) 기반 비대칭 키를 지원
  - EdDSA(Edwards-curve Digital Signature Algorithm) 서명/검증 지원
  - Solana, Cardano 등 Ed25519 기반 블록체인에서 사용 가능
  - 기존 AWS KMS의 모든 기능(키 관리, IAM, CloudTrail 감사, 키 정책) 적용

### Dagaon Core에 미치는 영향

이전에는 Solana 서명을 위해:
- 자체 HSM 솔루션 구축, 또는
- KMS 외부에서 Ed25519 키 관리, 또는
- GCP Cloud KMS 사용 (먼저 Ed25519 지원)

이 필요했으나, AWS KMS GA로 인해:
- 기존 AWS KMS 통합 레이어에 키 타입만 추가하면 됨
- AWS IAM/CloudTrail/키 정책 등 기존 보안 인프라 그대로 활용
- 멀티 클라우드 의존성 없이 AWS 단일 환경에서 해결

---

## AWS KMS 키 스펙 레퍼런스

### 문서

- **URL:** https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html
- **관련 섹션:** "Edwards Curve key specs" 또는 "EdDSA key specs"

### Ed25519 키 스펙 상세

| 항목 | 값 |
|------|-----|
| KeySpec | `ECC_EDWARDS_ED25519` |
| KeyUsage | `SIGN_VERIFY` |
| SigningAlgorithm | `EDDSA_SHA_512_ED25519` |
| MessageType (Sign) | `RAW` (해시가 아닌 원본 메시지) |
| 공개키 형식 | DER 인코딩 (SubjectPublicKeyInfo) |
| 서명 형식 | raw 64 bytes (r ∥ s) |
| 최대 메시지 크기 | 4,096 bytes (Solana TX 충분) |

### EVM 키 스펙과의 비교

| 항목 | EVM (secp256k1) | Solana (Ed25519) |
|------|----------------|-----------------|
| KeySpec | `ECC_SECG_P256K1` | `ECC_EDWARDS_ED25519` |
| SigningAlgorithm | `ECDSA_SHA_256` | `EDDSA_SHA_512_ED25519` |
| MessageType | `DIGEST` (해시) | `RAW` (원본) |
| 공개키 크기 | 65 bytes (비압축) / 33 bytes (압축) | 32 bytes |
| 서명 크기 | DER 가변 (70-72 bytes) | 고정 64 bytes |
| 주소 유도 | keccak256(pubkey)[12:32] → hex | pubkey → base58 |

---

## AWS SDK 코드 예시

### 키 생성

```javascript
import { KMSClient, CreateKeyCommand } from "@aws-sdk/client-kms";

const kms = new KMSClient({ region: "ap-northeast-2" });

const result = await kms.send(new CreateKeyCommand({
  KeySpec: "ECC_EDWARDS_ED25519",
  KeyUsage: "SIGN_VERIFY",
  Description: "Solana hot wallet - production",
  Tags: [
    { TagKey: "chain", TagValue: "solana" },
    { TagKey: "environment", TagValue: "production" },
    { TagKey: "wallet-type", TagValue: "hot" }
  ]
}));

const keyId = result.KeyMetadata.KeyId;
// 예: "1234abcd-12ab-34cd-56ef-1234567890ab"
```

### 공개키 추출 및 Solana 주소 변환

```javascript
import { GetPublicKeyCommand } from "@aws-sdk/client-kms";
import bs58 from "bs58";

const pubKeyResult = await kms.send(new GetPublicKeyCommand({
  KeyId: keyId
}));

// DER 인코딩된 공개키 (SubjectPublicKeyInfo 구조)
const derPublicKey = pubKeyResult.PublicKey;  // Uint8Array

// Ed25519 DER 공개키에서 raw 32 bytes 추출
// DER 구조: 30 2a 30 05 06 03 2b 65 70 03 21 00 [32 bytes]
// 마지막 32 bytes가 raw 공개키
const rawPublicKey = derPublicKey.slice(-32);

// base58 인코딩 → Solana 주소
const solanaAddress = bs58.encode(rawPublicKey);
// 예: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
```

### 서명

```javascript
import { SignCommand } from "@aws-sdk/client-kms";

// Solana TX 메시지 직렬화 (이미 serialize된 상태)
const messageBytes = transaction.serializeMessage();

const signResult = await kms.send(new SignCommand({
  KeyId: keyId,
  Message: messageBytes,
  MessageType: "RAW",           // 중요: DIGEST가 아닌 RAW
  SigningAlgorithm: "EDDSA_SHA_512_ED25519"
}));

const signature = signResult.Signature;  // Uint8Array, 64 bytes

// Solana TX에 서명 첨부
transaction.addSignature(
  new PublicKey(rawPublicKey),
  Buffer.from(signature)
);
```

### 서명 검증 (테스트용)

```javascript
import { VerifyCommand } from "@aws-sdk/client-kms";

const verifyResult = await kms.send(new VerifyCommand({
  KeyId: keyId,
  Message: messageBytes,
  MessageType: "RAW",
  Signature: signature,
  SigningAlgorithm: "EDDSA_SHA_512_ED25519"
}));

console.log("Signature valid:", verifyResult.SignatureValid);  // true
```

---

## 비용 및 한도

| 항목 | 값 |
|------|-----|
| 키 생성 비용 | $1/key/month |
| API 호출 (Sign/Verify) | $0.03 / 10,000 calls |
| API 호출 (GetPublicKey) | $0.03 / 10,000 calls |
| 요청 한도 | 5,500 TPS (Sign) per account per region |
| 키 삭제 대기 | 7-30일 (즉시 삭제 불가, 보안 정책) |

### 비용 예시

```
핫월렛 5개 운영, 일일 1,000건 출금:

키 비용: 5 keys x $1/month = $5/month
서명 호출: 1,000 calls/day x 30 = 30,000 calls/month
서명 비용: 30,000 / 10,000 x $0.03 = $0.09/month
기타 호출: ~$0.05/month

총 월 비용: ~$5.14/month
→ 무시 가능한 수준
```

---

## 리전별 가용성 확인 방법

```bash
# AWS CLI로 Ed25519 키 생성 가능 여부 확인
aws kms create-key \
  --key-spec ECC_EDWARDS_ED25519 \
  --key-usage SIGN_VERIFY \
  --description "Ed25519 availability test" \
  --region ap-northeast-2 \
  --dry-run

# 성공 시: 해당 리전에서 사용 가능
# 실패 시: UnsupportedOperationException → 해당 리전 미지원
```

GA 이후 대부분의 상용 리전에서 사용 가능하지만, 신규 리전이나 특수 리전(GovCloud 등)에서는 사전 확인 권장.

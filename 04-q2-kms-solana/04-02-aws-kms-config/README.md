# 4.2 AWS KMS 설정 비교

상위 섹션: [4. Q2: KMS Solana 지원 가능 여부](../README.md)

---

## 요약

AWS KMS API에서 EVM 키와 Solana 키를 생성하고 서명하는 설정을 비교한다.
동일한 SDK/CLI를 사용하며, 파라미터 값만 다르다.

## 핵심 설정 비교표

| 항목 | EVM (secp256k1) | Solana (Ed25519) |
|------|----------------|-----------------|
| Key Spec | `ECC_SECG_P256K1` | `ECC_NIST_EDWARDS25519` |
| Key Usage | `SIGN_VERIFY` | `SIGN_VERIFY` |
| Signing Algorithm | `ECDSA_SHA_256` | `EDDSA_ED25519_SHA_512` |
| Message Type | `DIGEST` | `RAW` |
| GetPublicKey 출력 | DER (secp256k1 SubjectPublicKeyInfo) | DER (Ed25519 SubjectPublicKeyInfo) |
| Sign 출력 | DER 인코딩된 (r,s) | 64바이트 raw (R,S) |

---

## 1. 키 생성: CreateKey

### EVM용 키 생성

```bash
aws kms create-key \
  --key-spec ECC_SECG_P256K1 \
  --key-usage SIGN_VERIFY \
  --description "Dagaon EVM hot wallet - secp256k1" \
  --tags '[{"TagKey":"chain","TagValue":"evm"},{"TagKey":"env","TagValue":"production"}]'
```

응답 (주요 필드):

```json
{
  "KeyMetadata": {
    "KeyId": "1234abcd-12ab-34cd-56ef-1234567890ab",
    "Arn": "arn:aws:kms:ap-northeast-2:123456789012:key/1234abcd-...",
    "KeyState": "Enabled",
    "KeyUsage": "SIGN_VERIFY",
    "KeySpec": "ECC_SECG_P256K1",
    "SigningAlgorithms": ["ECDSA_SHA_256"],
    "Origin": "AWS_KMS"
  }
}
```

### Solana용 키 생성

```bash
aws kms create-key \
  --key-spec ECC_NIST_EDWARDS25519 \
  --key-usage SIGN_VERIFY \
  --description "Dagaon Solana hot wallet - Ed25519" \
  --tags '[{"TagKey":"chain","TagValue":"solana"},{"TagKey":"env","TagValue":"production"}]'
```

응답 (주요 필드):

```json
{
  "KeyMetadata": {
    "KeyId": "5678efgh-56ef-78gh-90ij-567890abcdef",
    "Arn": "arn:aws:kms:ap-northeast-2:123456789012:key/5678efgh-...",
    "KeyState": "Enabled",
    "KeyUsage": "SIGN_VERIFY",
    "KeySpec": "ECC_NIST_EDWARDS25519",
    "SigningAlgorithms": ["EDDSA_ED25519_SHA_512"],
    "Origin": "AWS_KMS"
  }
}
```

### Alias 설정 (권장)

```bash
# EVM 키에 alias 부여
aws kms create-alias \
  --alias-name alias/dagaon-evm-hot-001 \
  --target-key-id 1234abcd-12ab-34cd-56ef-1234567890ab

# Solana 키에 alias 부여
aws kms create-alias \
  --alias-name alias/dagaon-sol-hot-001 \
  --target-key-id 5678efgh-56ef-78gh-90ij-567890abcdef
```

---

## 2. 공개키 추출: GetPublicKey

### EVM

```bash
aws kms get-public-key \
  --key-id alias/dagaon-evm-hot-001 \
  --output json
```

응답:

```json
{
  "KeyId": "arn:aws:kms:ap-northeast-2:123456789012:key/1234abcd-...",
  "KeySpec": "ECC_SECG_P256K1",
  "KeyUsage": "SIGN_VERIFY",
  "SigningAlgorithms": ["ECDSA_SHA_256"],
  "PublicKey": "MFYwEAYHKoZIzj0CAQYFK4EE..."
}
```

`PublicKey`는 Base64 인코딩된 DER (SubjectPublicKeyInfo) 형식이다.
secp256k1의 경우 88바이트 (헤더 23B + 비압축 공개키 65B).

### Solana

```bash
aws kms get-public-key \
  --key-id alias/dagaon-sol-hot-001 \
  --output json
```

응답:

```json
{
  "KeyId": "arn:aws:kms:ap-northeast-2:123456789012:key/5678efgh-...",
  "KeySpec": "ECC_NIST_EDWARDS25519",
  "KeyUsage": "SIGN_VERIFY",
  "SigningAlgorithms": ["EDDSA_ED25519_SHA_512"],
  "PublicKey": "MCowBQYDK2VwAyEA..."
}
```

`PublicKey`는 Base64 인코딩된 DER (SubjectPublicKeyInfo) 형식이다.
Ed25519의 경우 44바이트 (헤더 12B + raw 공개키 32B).

---

## 3. 서명: Sign

### EVM 서명

```bash
# 1. 트랜잭션을 RLP 인코딩하고 keccak256 해시를 계산 (애플리케이션에서 수행)
# 2. 32바이트 해시를 KMS에 전달

aws kms sign \
  --key-id alias/dagaon-evm-hot-001 \
  --message fileb://tx-hash.bin \
  --message-type DIGEST \
  --signing-algorithm ECDSA_SHA_256 \
  --output json
```

응답:

```json
{
  "KeyId": "arn:aws:kms:...",
  "Signature": "MEUCIQD...",
  "SigningAlgorithm": "ECDSA_SHA_256"
}
```

`Signature`는 Base64 인코딩된 DER 형식 (70~72바이트).
애플리케이션에서 DER을 파싱하여 r, s를 추출하고 v(recovery id)를 계산해야 한다.

### Solana 서명

```bash
# 1. Solana 트랜잭션 메시지를 직렬화 (애플리케이션에서 수행)
# 2. 직렬화된 메시지 바이트를 KMS에 그대로 전달

aws kms sign \
  --key-id alias/dagaon-sol-hot-001 \
  --message fileb://solana-message.bin \
  --message-type RAW \
  --signing-algorithm EDDSA_ED25519_SHA_512 \
  --output json
```

응답:

```json
{
  "KeyId": "arn:aws:kms:...",
  "Signature": "base64...",
  "SigningAlgorithm": "EDDSA_ED25519_SHA_512"
}
```

`Signature`는 Base64 인코딩된 64바이트 raw 서명 (R 32B + S 32B).
DER 파싱이 필요 없다. 디코딩하면 그대로 Solana 트랜잭션에 첨부할 수 있다.

---

## 4. MessageType 차이: DIGEST vs RAW

이 차이는 KMS 통합에서 가장 중요한 부분이다.

### DIGEST (EVM에서 사용)

```
의미: "내가 보내는 데이터는 이미 해시된 값이다. 다시 해시하지 마라."

흐름:
1. 애플리케이션: hash = keccak256(RLP(tx))  → 32바이트
2. KMS에 전달: Sign(message=hash, messageType=DIGEST, algorithm=ECDSA_SHA_256)
3. KMS 내부: ECDSA 서명 수행 (추가 해싱 없음)

왜 DIGEST를 사용하는가?
- EVM은 keccak256 해시를 사용하지만, KMS의 ECDSA_SHA_256는 내부적으로 SHA-256을 사용
- 애플리케이션이 먼저 keccak256으로 해시하고, DIGEST로 전달하면 KMS가 추가 해싱을 건너뜀
- 이렇게 해야 EVM 호환 서명이 생성됨
```

### RAW (Solana에서 사용)

```
의미: "내가 보내는 데이터는 원본 메시지다. 네가 해시해라."

흐름:
1. 애플리케이션: serializedMsg = serialize(tx.compileMessage())
2. KMS에 전달: Sign(message=serializedMsg, messageType=RAW, algorithm=EDDSA_ED25519_SHA_512)
3. KMS 내부: Ed25519 서명 수행 (내부적으로 SHA-512 해싱 포함)

왜 RAW를 사용하는가?
- Ed25519 사양(RFC 8032)에서 서명 과정에 SHA-512 해싱이 포함됨
- 외부에서 먼저 해시하면 "hash of hash"가 되어 서명 검증 실패
- 반드시 원본 메시지를 전달해야 함
```

### MessageType 잘못 사용하면?

```
실수 1: Solana에서 DIGEST 사용
→ KMS가 메시지를 이미 해시된 값으로 간주
→ Ed25519 내부에서 다시 SHA-512 해싱
→ 최종 서명이 "원본 메시지의 해시"가 아닌 "해시의 해시"에 대한 서명이 됨
→ Solana 네트워크에서 서명 검증 실패
→ 트랜잭션 거부

실수 2: EVM에서 RAW 사용 (원본 트랜잭션 바이트 전달)
→ KMS가 내부적으로 SHA-256으로 해시
→ 그런데 EVM은 keccak256 해시를 기대
→ 서명이 keccak256이 아닌 SHA-256 해시에 대한 것이 됨
→ EVM 네트워크에서 서명 검증 실패
→ 트랜잭션 거부
```

---

## 5. AWS SDK (TypeScript) 예제

### 키 생성

```typescript
import { KMSClient, CreateKeyCommand } from '@aws-sdk/client-kms';

const kms = new KMSClient({ region: 'ap-northeast-2' });

// EVM 키 생성
const evmKey = await kms.send(new CreateKeyCommand({
  KeySpec: 'ECC_SECG_P256K1',
  KeyUsage: 'SIGN_VERIFY',
  Description: 'Dagaon EVM hot wallet',
  Tags: [{ TagKey: 'chain', TagValue: 'evm' }],
}));

// Solana 키 생성
const solKey = await kms.send(new CreateKeyCommand({
  KeySpec: 'ECC_NIST_EDWARDS25519',
  KeyUsage: 'SIGN_VERIFY',
  Description: 'Dagaon Solana hot wallet',
  Tags: [{ TagKey: 'chain', TagValue: 'solana' }],
}));
```

### 공개키 추출

```typescript
import { GetPublicKeyCommand } from '@aws-sdk/client-kms';

const pubKeyResponse = await kms.send(new GetPublicKeyCommand({
  KeyId: solKey.KeyMetadata!.KeyId!,
}));

// DER 인코딩된 공개키 (44 bytes for Ed25519)
const derPublicKey = pubKeyResponse.PublicKey!; // Uint8Array

// Ed25519 DER 헤더 (12 bytes) 제거 → raw 32-byte 공개키
const rawPublicKey = derPublicKey.slice(12); // 32 bytes

// Solana 주소 = base58(rawPublicKey)
import bs58 from 'bs58';
const solanaAddress = bs58.encode(rawPublicKey);
```

### 서명

```typescript
import { SignCommand } from '@aws-sdk/client-kms';

// --- EVM 서명 ---
const evmSignature = await kms.send(new SignCommand({
  KeyId: evmKeyId,
  Message: keccak256Hash,           // 32바이트 해시
  MessageType: 'DIGEST',            // ★ 해시를 보낸다
  SigningAlgorithm: 'ECDSA_SHA_256',
}));
// evmSignature.Signature는 DER 인코딩 → r, s 파싱 필요

// --- Solana 서명 ---
const solSignature = await kms.send(new SignCommand({
  KeyId: solKeyId,
  Message: serializedMessage,           // 원본 메시지 바이트
  MessageType: 'RAW',                   // ★ 원본을 보낸다
  SigningAlgorithm: 'EDDSA_ED25519_SHA_512',
}));
// solSignature.Signature는 64바이트 raw → 그대로 사용
```

---

## 6. IAM 정책 예시

기존 EVM KMS 정책을 그대로 사용할 수 있다.
추가적인 Action이 필요하지 않다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowDagaonSigning",
      "Effect": "Allow",
      "Action": [
        "kms:Sign",
        "kms:GetPublicKey",
        "kms:DescribeKey"
      ],
      "Resource": [
        "arn:aws:kms:ap-northeast-2:123456789012:key/*"
      ],
      "Condition": {
        "StringEquals": {
          "aws:ResourceTag/env": "production"
        }
      }
    },
    {
      "Sid": "AllowKeyCreation",
      "Effect": "Allow",
      "Action": [
        "kms:CreateKey",
        "kms:CreateAlias",
        "kms:TagResource"
      ],
      "Resource": "*"
    }
  ]
}
```

KMS 정책의 Action(kms:Sign, kms:GetPublicKey 등)은 키 타입에 무관하다.
secp256k1 키든 Ed25519 키든 동일한 IAM 정책으로 접근할 수 있다.

---

## 7. 비용 비교

| 항목 | EVM (secp256k1) | Solana (Ed25519) |
|------|----------------|-----------------|
| 키 생성 | 무료 (키 보관료만) | 무료 (키 보관료만) |
| 키 보관 | $1/월/키 | $1/월/키 |
| Sign API | $0.15/10,000건 (RSA), $0.03/10,000건 (ECC) | $0.03/10,000건 (ECC) |
| GetPublicKey API | $0.03/10,000건 | $0.03/10,000건 |

Ed25519도 ECC 카테고리에 속하므로, 비용 구조는 secp256k1과 동일하다.

---

## 8. 리전별 지원 현황 확인

Ed25519 KMS 키가 특정 리전에서 지원되는지 확인하는 방법:

```bash
# 리전에서 지원하는 KeySpec 목록 확인
aws kms describe-key \
  --key-id alias/dagaon-sol-hot-001 \
  --region ap-northeast-2 \
  --query 'KeyMetadata.KeySpec'

# 또는 CreateKey를 시도하여 확인
aws kms create-key \
  --key-spec ECC_NIST_EDWARDS25519 \
  --key-usage SIGN_VERIFY \
  --description "test-ed25519" \
  --region ap-northeast-2
```

프로덕션 배포 전에 반드시 타겟 리전에서 테스트해야 한다.

## 참고

- [AWS KMS CreateKey API](https://docs.aws.amazon.com/kms/latest/APIReference/API_CreateKey.html)
- [AWS KMS Sign API](https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html)
- [AWS KMS GetPublicKey API](https://docs.aws.amazon.com/kms/latest/APIReference/API_GetPublicKey.html)
- [AWS KMS Asymmetric Key Specs](https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html)
- [AWS KMS Pricing](https://aws.amazon.com/kms/pricing/)

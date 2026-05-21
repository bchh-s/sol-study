# 결론: AWS KMS가 Ed25519를 네이티브 지원한다 (2025.11~)

상위 섹션: [4. Q2: KMS Solana 지원 가능 여부](../README.md)

---

## Executive Summary

**Dagaon Core의 기존 AWS KMS 인프라를 그대로 사용하여 Solana 트랜잭션에 서명할 수 있다.**

2025년 11월, AWS는 KMS에 Ed25519 (Edwards-curve Digital Signature Algorithm) 키 타입을 추가했다.
이로써 동일한 KMS 인스턴스에서 EVM용 secp256k1 키와 Solana용 Ed25519 키를 동시에 관리할 수 있게 되었다.

### 한 줄 요약

> KMS 인프라 변경 없이, 새 키 타입(Ed25519)으로 키를 생성하고 Signing Algorithm만 바꾸면 Solana 서명이 된다.

## 무엇이 가능해졌는가

### Before (2025.11 이전)

```
AWS KMS 지원 비대칭 키 타입:
- RSA (2048, 3072, 4096)
- ECC_NIST_P256 (secp256r1)
- ECC_NIST_P384 (secp384r1)
- ECC_NIST_P521 (secp521r1)
- ECC_SECG_P256K1 (secp256k1) ← EVM은 이것 사용
- SM2 (중국 표준)

→ Ed25519 미지원. Solana 서명 불가능.
```

### After (2025.11 이후)

```
AWS KMS 지원 비대칭 키 타입:
- RSA (2048, 3072, 4096)
- ECC_NIST_P256 (secp256r1)
- ECC_NIST_P384 (secp384r1)
- ECC_NIST_P521 (secp521r1)
- ECC_SECG_P256K1 (secp256k1) ← EVM은 이것 사용
- SM2 (중국 표준)
- ECC_NIST_EDWARDS25519 (Ed25519) ← ★ 신규. Solana 서명 가능!

→ Ed25519 네이티브 지원. KMS 안에서 Solana 서명 완전 가능.
```

## 무엇이 달라지는가 (코드 레벨)

### 1. 키 생성 -- 파라미터 하나만 다르다

```
EVM:   CreateKey(KeySpec=ECC_SECG_P256K1,     KeyUsage=SIGN_VERIFY)
Solana: CreateKey(KeySpec=ECC_NIST_EDWARDS25519, KeyUsage=SIGN_VERIFY)
```

KeyUsage는 동일하게 `SIGN_VERIFY`이다. 키 스펙만 바뀐다.

### 2. 서명 -- Algorithm과 MessageType이 다르다

```
EVM:   Sign(KeyId, Message=keccak256_hash, Algorithm=ECDSA_SHA_256,          MessageType=DIGEST)
Solana: Sign(KeyId, Message=raw_tx_bytes,   Algorithm=EDDSA_ED25519_SHA_512, MessageType=RAW)
```

핵심 차이:
- **EVM**: 트랜잭션의 keccak256 **해시**를 KMS에 보낸다 (DIGEST)
- **Solana**: 트랜잭션의 **원본 바이트**를 KMS에 보낸다 (RAW)

이유: Ed25519는 서명 알고리즘 내부에서 SHA-512 해싱을 수행한다.
외부에서 먼저 해시를 하면 이중 해싱이 되어 서명이 깨진다.

### 3. 공개키 추출 -- DER 헤더 크기가 다르다

```
EVM:    DER 바이트 → ASN.1 헤더 제거 → 64바이트 uncompressed pubkey → keccak256 → 하위 20바이트 → hex
Solana: DER 바이트 → ASN.1 헤더 제거 (12바이트 고정) → 32바이트 raw pubkey → base58 = 주소
```

Solana는 주소가 곧 공개키이므로 해싱이 필요 없다.

## 무엇이 그대로인가

| 항목 | 동일 여부 | 설명 |
|------|----------|------|
| KMS 인스턴스 | 동일 | 별도 KMS 구축 불필요 |
| IAM 정책 | 동일 | `kms:Sign`, `kms:GetPublicKey`, `kms:CreateKey` 그대로 |
| CloudTrail 감사 | 동일 | 모든 서명 호출이 자동 기록 |
| Key Rotation 정책 | 동일 | AWS 관리형 로테이션 사용 가능 (단, 비대칭 키는 수동) |
| 비용 구조 | 동일 | API 호출 건수 기반 과금, 키 타입 무관 |
| 네트워크 구성 | 동일 | VPC Endpoint로 접근, private subnet 유지 |
| SDK 사용 | 동일 | `@aws-sdk/client-kms`의 동일 API (CreateKeyCommand, SignCommand, GetPublicKeyCommand) |

## Dagaon Core에 미치는 영향

### 변경 필요 컴포넌트

```
dagaon-core/
├── kms/
│   ├── key-manager.ts          ← chain_type에 따라 KeySpec 분기 추가
│   ├── signer.ts               ← chain_type에 따라 Algorithm/MessageType 분기 추가
│   └── address-derivation.ts   ← Solana용 DER→base58 로직 추가
├── config/
│   └── chain-config.ts         ← Solana 체인 설정 추가
└── models/
    └── key-metadata.ts         ← chain_type 필드 추가 (EVM | SOLANA)
```

### 변경 불필요 컴포넌트

```
dagaon-core/
├── kms/
│   ├── kms-client.ts           ← AWS SDK 호출 래퍼, 변경 없음
│   └── key-rotation.ts         ← 로테이션 로직, 변경 없음
├── infra/
│   ├── vpc-endpoint.ts         ← 네트워크 설정, 변경 없음
│   └── iam-policy.ts           ← 권한 구조, 변경 없음
└── monitoring/
    └── cloudtrail.ts           ← 감사 로그, 변경 없음
```

## 리스크와 고려사항

### 1. 비대칭 키는 자동 로테이션 불가

AWS KMS의 자동 키 로테이션은 **대칭 키**에만 적용된다.
비대칭 키(secp256k1이든 Ed25519이든)는 수동 로테이션이 필요하다.
이건 EVM에서도 이미 같은 상황이므로 새로운 리스크는 아니다.

### 2. Ed25519 KMS 키의 리전 가용성

AWS가 Ed25519를 지원하는 리전을 확인해야 한다.
대부분의 주요 리전(us-east-1, ap-northeast-2 등)에서 지원하지만,
프로덕션 배포 전에 타겟 리전에서 실제 CreateKey를 테스트해야 한다.

### 3. KMS 호출 레이턴시

KMS Sign API는 호출당 수십~수백 ms의 레이턴시가 있다.
Solana의 400ms 블록타임을 고려하면, KMS 레이턴시가 트랜잭션 제출 타이밍에 영향을 줄 수 있다.
tx-signer worker 수를 산정할 때 이를 반영해야 한다.

## 참고

- [AWS KMS Asymmetric Key Specs 공식 문서](https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html)
- [AWS KMS Sign API Reference](https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html)
- 하위 섹션 4.1~4.5에서 각 항목을 상세히 다룬다.

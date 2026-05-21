# 4. Q2: KMS Solana 지원 가능 여부

## 핵심 질문

> Dagaon Core는 현재 AWS KMS로 EVM 트랜잭션에 서명한다.
> Solana 체인을 추가하려면 KMS를 별도로 구축해야 하는가, 아니면 기존 인프라를 확장할 수 있는가?

## 결론 (먼저 읽기)

**가능하다.** AWS KMS가 2025년 11월부터 Ed25519 (EdDSA) 키를 네이티브 지원한다.
동일한 KMS 인스턴스에서 secp256k1 (EVM) 키와 Ed25519 (Solana) 키를 함께 관리할 수 있다.
별도의 HSM이나 KMS 인프라 없이 Dagaon Core의 기존 KMS 아키텍처를 그대로 확장하면 된다.

## 왜 이 질문이 중요한가

Dagaon Core의 보안 모델에서 KMS는 **단일 진실 공급원(single source of truth)** 이다.
모든 private key는 KMS 안에만 존재하고, 애플리케이션 코드는 private key에 접근할 수 없다.
Solana를 지원하려면 이 보안 모델을 깨지 않으면서 Ed25519 서명을 수행할 수 있어야 한다.

만약 AWS KMS가 Ed25519를 지원하지 않았다면, 다음 중 하나를 선택해야 했다:
1. **별도 HSM 구축** -- 비용 증가, 운영 복잡도 증가
2. **소프트웨어 키 관리** -- 보안 모델 약화 (private key가 메모리에 노출)
3. **Solana 지원 포기** -- 사업적 제약

다행히 이 중 어떤 것도 필요 없다.

## 변경이 필요한 것 vs 그대로 유지되는 것

### 그대로 유지되는 것

| 항목 | 설명 |
|------|------|
| KMS 인프라 | 동일한 AWS KMS 인스턴스 사용 |
| IAM 정책 구조 | 기존 kms:Sign, kms:GetPublicKey 권한 체계 그대로 |
| 키 관리 패턴 | key_id 기반 라우팅, alias 태깅 |
| 보안 모델 | private key never leaves KMS |
| 모니터링 | CloudTrail 기반 서명 감사 로그 |

### 변경이 필요한 것

| 항목 | EVM (현재) | Solana (추가) |
|------|-----------|--------------|
| Key Spec | `ECC_SECG_P256K1` | `ECC_NIST_EDWARDS25519` |
| Signing Algorithm | `ECDSA_SHA_256` | `EDDSA_ED25519_SHA_512` |
| Message Type | `DIGEST` (해시 전달) | `RAW` (원본 메시지 전달) |
| 공개키 추출 | DER -> 64B uncompressed -> keccak256 -> 20B | DER -> 12B 헤더 제거 -> 32B raw |
| 주소 포맷 | hex (0x...) | base58 |
| TX 직렬화 | RLP 인코딩 | Solana 바이너리 포맷 |

## 이 섹션의 구성

| 하위 섹션 | 내용 |
|----------|------|
| [결론: AWS KMS Ed25519 지원](./01-conclusion-kms-ed25519/README.md) | Executive Summary -- 무엇이 가능해졌고, 무엇이 달라지는가 |
| [4.1 키/서명 알고리즘 비교](./04-01-key-signing-algorithms/README.md) | secp256k1 vs Ed25519, ECDSA vs EdDSA 심층 비교 |
| [4.2 AWS KMS 설정 비교](./04-02-aws-kms-config/README.md) | CreateKey, Sign API 파라미터, AWS CLI 예제 |
| [4.3 공개키 추출 및 주소 도출](./04-03-public-key-address/README.md) | DER 파싱, ASN.1 헤더, base58 인코딩 |
| [4.4 서명 워크플로우 비교](./04-04-signing-workflow/README.md) | EVM과 Solana의 트랜잭션 서명 플로우 상세 비교 |
| [4.5 듀얼 체인 KMS 아키텍처](./04-05-dual-chain-kms/README.md) | 단일 KMS에서 멀티체인 운용하는 아키텍처 설계 |

## 실행 가능한 코드

[`code/key-signing-demo.ts`](./code/key-signing-demo.ts) -- Ed25519 키 생성, 서명, 검증을 로컬에서 시뮬레이션하는 데모.
KMS 호출 구조를 그대로 따르되, 실제 KMS 대신 로컬 키쌍으로 동작한다.

```bash
cd 04-q2-kms-solana/code
npm install   # 최초 1회
npx tsx key-signing-demo.ts
```

## 참고 링크

- [AWS KMS Asymmetric Key Specs](https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html)
- [AWS KMS Sign API](https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html)
- [Solana Transactions](https://solana.com/docs/core/transactions)
- [Ed25519 RFC 8032](https://datatracker.ietf.org/doc/html/rfc8032)
- [BIP-44 Specification](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)

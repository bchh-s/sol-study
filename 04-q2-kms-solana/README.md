# 4. Q2: KMS Solana 지원 가능 여부

원문: ../solana-integration-research.md

## 이 폴더의 목표

AWS KMS 기반 Ed25519 키 생성, 공개키 추출, Solana message signing을 검증한다.

## 원문에서 먼저 볼 소제목

  - 결론: 가능하다. AWS KMS가 Ed25519를 네이티브 지원한다 (2025.11~).
  - 4.1 키/서명 알고리즘 비교
  - 4.2 AWS KMS 설정 비교
  - 4.3 공개키 추출 및 주소 도출
  - 4.4 서명 워크플로우 비교
  - 4.5 듀얼 체인 KMS 아키텍처

## 개발할 내용

1. KMS key spec/signing algorithm을 체인별 설정으로 분리한다: EVM secp256k1/ECDSA, Solana Ed25519/EdDSA.
2. GetPublicKey DER에서 Ed25519 raw 32-byte public key를 추출하고 base58 주소를 만든다.
3. Solana transaction message bytes를 RAW로 KMS Sign에 전달하는 signer PoC를 작성한다.
4. 서명 검증 테스트를 추가한다: local ed25519 verify + Solana SDK signature verification.
5. KMS latency/throughput 측정을 넣어 tx-signer worker 수 산정에 반영한다.

## 공부할 내용

1. Ed25519/EdDSA와 secp256k1/ECDSA의 서명 입력, 출력, determinism 차이를 이해한다.
2. Solana 주소가 public key 자체라는 점과 base58 encoding을 학습한다.
3. KMS RAW/DIGEST MessageType 차이를 문서화한다.

## 실습/검증 과제

1. dev/test KMS 키로 public key -> base58 address 변환 golden test를 만든다.
2. 동일 Solana message에 대해 KMS 서명 결과를 검증하고 signed transaction serialization을 확인한다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 하위 header 폴더

- [결론: 가능하다. AWS KMS가 Ed25519를 네이티브 지원한다 (2025.11~).](./01-conclusion-kms-ed25519/README.md)
- [4.1 키/서명 알고리즘 비교](./04-01-key-signing-algorithms/README.md)
- [4.2 AWS KMS 설정 비교](./04-02-aws-kms-config/README.md)
- [4.3 공개키 추출 및 주소 도출](./04-03-public-key-address/README.md)
- [4.4 서명 워크플로우 비교](./04-04-signing-workflow/README.md)
- [4.5 듀얼 체인 KMS 아키텍처](./04-05-dual-chain-kms/README.md)

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html

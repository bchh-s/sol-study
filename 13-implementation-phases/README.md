# 13. 구현 페이즈

원문: ../solana-integration-research.md

## 이 폴더의 목표

12주 로드맵을 테스트 가능한 milestone과 exit criteria로 바꾼다.

## 원문에서 먼저 볼 소제목

  - 이 섹션은 원문 표/결론을 기준으로 학습한다.

## 개발할 내용

1. Phase 1은 KMS signer PoC, RPC wrapper, schema migration, base58 util까지 완료 기준을 둔다.
2. Phase 2는 finalized block sync와 SOL/SPL deposit E2E를 완료 기준으로 둔다.
3. Phase 3은 durable nonce withdrawal, ATA 자동 생성, resend monitor E2E를 완료 기준으로 둔다.
4. Phase 4는 load/soak/canary/runbook/alert를 완료 기준으로 둔다.
5. 각 phase 말에 rollback plan과 EVM regression suite 실행을 포함한다.

## 공부할 내용

1. 각 phase의 blocking dependency를 확인한다: KMS 키 생성 권한, RPC provider, devnet token mint, DB migration window.
2. Solana mainnet volume과 비용 산정 방식을 학습한다.

## 실습/검증 과제

1. GitHub issue/Linear ticket으로 쪼갤 수 있는 task breakdown을 작성한다.
2. Phase별 demo script를 만든다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html

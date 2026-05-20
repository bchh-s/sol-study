# 8. 컴포넌트별 영향도 분석

원문: ../solana-integration-research.md

## 이 폴더의 목표

컴포넌트별 작업 범위와 우선순위를 backlog로 변환한다.

## 원문에서 먼저 볼 소제목

  - 이 섹션은 원문 표/결론을 기준으로 학습한다.

## 개발할 내용

1. 각 컴포넌트에 owner, risk, dependency, test strategy를 추가한 implementation matrix를 만든다.
2. 완전 재사용 컴포넌트는 regression test만 추가하고, 신규 컴포넌트는 PoC -> integration 순서로 나눈다.
3. Event Confirmer 제거처럼 파이프라인이 달라지는 부분은 feature flag/chain config로 명확히 분기한다.

## 공부할 내용

1. 기존 plugin registry 패턴의 확장 지점과 누수되는 EVM 가정을 찾는다.
2. HA/lock/checkpoint 설계가 chain-agnostic한지 검토한다.

## 실습/검증 과제

1. 컴포넌트별 “첫 번째 테스트”를 정의한다.
2. Solana path를 추가했을 때 EVM regression이 없는지 smoke test 목록을 작성한다.

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

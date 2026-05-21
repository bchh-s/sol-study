# 11. 리스크 평가

원문: ../solana-integration-research.md

## 이 폴더의 목표

기술 리스크를 운영 지표, 알림, fallback으로 연결한다.

## 원문에서 먼저 볼 소제목

  - 높은 리스크
  - 중간 리스크
  - 낮은 리스크

## 개발할 내용

1. TX landing rate, resend count, time-to-finalized, nonce pool utilization, RPC error rate 지표를 정의한다.
2. risk별 runbook을 만든다: RPC outage, nonce pool 고갈, signature unknown 지속, ATA 생성 실패, fee payer 잔액 부족.
3. 실패 TX fee 회계와 사용자 상태 노출 정책을 정한다.
4. mainnet 전환 전 synthetic withdrawal canary를 만든다.

## 공부할 내용

1. Solana 네트워크 혼잡 시 transaction drop/priority fee가 어떻게 작동하는지 사례를 조사한다.
2. RPC provider 장애 패턴과 multi-provider 전략을 학습한다.

## 실습/검증 과제

1. 각 high risk에 대해 chaos test 또는 manual drill을 설계한다.
2. 알림 임계값 초안을 작성하고 devnet soak test로 조정한다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 하위 header 폴더

- [높은 리스크](./01-high-risks/README.md)
- [중간 리스크](./02-medium-risks/README.md)
- [낮은 리스크](./03-low-risks/README.md)

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html

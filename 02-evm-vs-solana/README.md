# 2. EVM vs Solana 핵심 차이 요약

원문: ../solana-integration-research.md

## 이 폴더의 목표

두 체인의 차이를 암기용 비교표가 아니라 구현 의사결정으로 연결한다.

## 원문에서 먼저 볼 소제목

  - 이 섹션은 원문 표/결론을 기준으로 학습한다.

## 개발할 내용

1. 주소 타입을 string 하나로 방치하지 말고 chain별 validator/normalizer를 둔다.
2. nonce/gas/log 중심의 기존 DTO를 Solana slot/blockhash/compute/balance-diff DTO와 분리한다.
3. 실패 TX 처리 정책을 통일한다: EVM receipt status vs Solana meta.err.
4. 토큰 처리에서 ERC20 event와 SPL token balance diff를 같은 Transfer domain model로 매핑하는 adapter를 설계한다.

## 공부할 내용

1. slot, block height, commitment, recent blockhash, durable nonce의 관계를 그림으로 설명할 수 있게 공부한다.
2. SPL Token/ATA/rent-exempt가 ERC20과 다른 운영 비용을 만드는 이유를 이해한다.
3. local fee market과 compute unit price/limit 계산 방식을 학습한다.

## 실습/검증 과제

1. 비교표의 각 행마다 “코드에서 바뀌는 파일/모듈” 컬럼을 추가한다.
2. Solana devnet에서 SOL transfer와 SPL token transfer의 parsed transaction JSON을 내려받아 EVM receipt와 비교한다.

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

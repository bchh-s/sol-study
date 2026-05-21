# 14. 결론

원문: ../solana-integration-research.md

## 이 폴더의 목표

통합 가능성 결론을 실행 가능한 next action으로 압축한다.

## 원문에서 먼저 볼 소제목

  - 재사용 가능한 것:
  - 새로 구현해야 하는 것:
  - 오히려 좋아지는 것:

## 개발할 내용

1. 재사용/신규/삭제 항목을 최종 architecture diagram에 반영한다.
2. 가장 먼저 검증할 3개 spike를 만든다: KMS Ed25519 signing, finalized block scan, durable nonce withdrawal.
3. 경영/운영 공유용 1-page summary를 작성한다.

## 공부할 내용

1. Solana 통합이 EVM 확장 작업이 아니라 별도 chain adapter 추가라는 관점을 정리한다.
2. 좋아지는 점(finality/fee delegation)과 나빠지는 점(nonce pool/RPC volume)을 균형 있게 설명할 수 있게 연습한다.

## 실습/검증 과제

1. 30분 기술 리뷰 발표 자료 목차를 만든다.
2. “내일부터 무엇을 할 것인가” 체크리스트를 작성한다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 하위 header 폴더

- [재사용 가능한 것:](./01-reusable-components/README.md)
- [새로 구현해야 하는 것:](./02-new-components/README.md)
- [오히려 좋아지는 것:](./03-improvements/README.md)

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html

# 3. Q1: Block Sync 아키텍처 호환성

원문: ../solana-integration-research.md

## 이 폴더의 목표

EVM block number 순회 방식을 Solana finalized slot 스캐너로 치환한다.

## 원문에서 먼저 볼 소제목

  - 결론: 가능하다. 스캐닝 방식만 변경 필요.
  - 3.1 Slot/Block 모델 이해
  - 3.2 블록 스캐닝 방식 비교
  - 3.3 Reorg 처리
  - 3.4 Kafka/S3 적재
  - 3.5 Transfer 추출 방식 비교
  - 3.6 Event Confirmer

## 개발할 내용

1. getSlot(finalized)로 upper bound를 잡고 getBlocks(start,end,finalized)로 빈 슬롯을 건너뛴다.
2. getBlock 호출 옵션을 고정한다: encoding=jsonParsed 또는 json, transactionDetails=full, rewards=false, maxSupportedTransactionVersion=0.
3. publisher checkpoint를 block_number가 아니라 slot_number 기준으로 저장한다.
4. consumer는 meta.err != null TX를 transfer 추출에서 제외한다.
5. pre/postBalances와 pre/postTokenBalances diff를 instruction index와 연결하는 extractor PoC를 만든다.

## 공부할 내용

1. finalized commitment의 의미와 confirmed/processed와의 차이를 학습한다.
2. 빈 슬롯, skipped slot, block_height와 slot_number 차이를 이해한다.
3. 대량 블록 싱크에서 HTTP RPC vs Geyser/Yellowstone trade-off를 조사한다.

## 실습/검증 과제

1. devnet에서 최근 100개 finalized slot에 대해 getBlocks 결과와 slot range 길이를 비교한다.
2. 샘플 block JSON 3개를 저장하고 SOL/SPL transfer를 수작업으로 표시한다.
3. reorg 방어용 previousBlockhash 검증을 넣을지 ADR로 결정한다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 하위 header 폴더

- [결론: 가능하다. 스캐닝 방식만 변경 필요.](./01-conclusion-scanning-change/README.md)
- [3.1 Slot/Block 모델 이해](./03-01-slot-block-model/README.md)
- [3.2 블록 스캐닝 방식 비교](./03-02-block-scanning-comparison/README.md)
- [3.3 Reorg 처리](./03-03-reorg-handling/README.md)
- [3.4 Kafka/S3 적재](./03-04-kafka-s3-publishing/README.md)
- [3.5 Transfer 추출 방식 비교](./03-05-transfer-extraction/README.md)
- [3.6 Event Confirmer](./03-06-event-confirmer/README.md)

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html

# 3. Q1: Block Sync 아키텍처 호환성

> **결론: Solana 통합이 가능하다. 기존 파이프라인(Kafka/S3/etcd)은 재사용하고, 스캐닝 방식과 Transfer 추출 로직만 변경하면 된다.**

## 문제 정의

Dagaon Core의 입금 파이프라인은 EVM의 순차적 블록 모델에 최적화되어 있다.
Solana는 400ms 슬롯, 빈 슬롯, balance diff 기반 transfer 추출 등 근본적으로 다른 모델을 사용한다.
이 섹션에서는 기존 파이프라인의 각 단계를 Solana에 맞게 어떻게 변경해야 하는지 분석한다.

## 아키텍처 비교

### EVM 입금 파이프라인 (현재)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         EVM Block Sync Pipeline                              │
│                                                                              │
│  Blockchain     Block Publisher        Kafka/S3       Block Consumer   Event  │
│   Node         ┌──────────────┐      ┌─────────┐    ┌─────────────┐  Confirmer
│                │              │      │         │    │             │  ┌──────┐│
│  getBlock      │ parentHash   │ ───► │ Block   │───►│ Event Log   │─►│last- ││
│  ByNumber(n)   │ RingBuffer   │      │ JSON    │    │ 파싱        │  │block ││
│  n++           │ reorg 감지   │      │ 메시지  │    │ Transfer()  │  │-conf ││
│                │              │      │         │    │ topic 매칭  │  │blocks││
│  ※ 모든 n에   │ checkpoint:  │      │ S3 백업 │    │             │  │임계값││
│    블록 존재   │ block_number │      │         │    │ log_index   │  │      ││
│                └──────────────┘      └─────────┘    └─────────────┘  └──────┘│
│                                                                              │
│  12s/block        reorg 발생 시          동일          ERC20/721       필수   │
│  순차 증가        되돌림 필요                          event log       (finality│
│                                                       파싱             대기)  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Solana 입금 파이프라인 (변경)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                       Solana Block Sync Pipeline                             │
│                                                                              │
│  Blockchain     Block Publisher        Kafka/S3       Block Consumer   Event  │
│   Node         ┌──────────────┐      ┌─────────┐    ┌─────────────┐  Confirmer
│                │              │      │         │    │             │  ┌──────┐│
│  getBlocks     │ previous     │ ───► │ Block   │───►│ Balance     │  │      ││
│  (start,end,   │ Blockhash    │      │ JSON    │    │ Diff 계산   │  │ 불필 ││
│  "finalized")  │ 방어적 검증  │      │ 메시지  │    │ pre/post    │  │  요  ││
│  → getBlock    │              │      │         │    │ Balances    │  │      ││
│  (slot)        │ checkpoint:  │      │ S3 백업 │    │             │  │finali││
│                │ slot_number  │      │         │    │ meta.err    │  │zed로 ││
│  ※ 빈 슬롯    │              │      │ 포맷만  │    │ 체크 필수   │  │이미  ││
│    자동 제외   └──────────────┘      │ 변경    │    └─────────────┘  │확정  ││
│                                      └─────────┘                     └──────┘│
│  400ms/slot    finalized에서          재사용       SOL: balance diff   제거   │
│  빈 슬롯 존재  reorg 사실상 없음                   SPL: token balance  가능   │
│                                                    diff                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 핵심 변경 요약

| 파이프라인 단계 | EVM (현재) | Solana (변경) | 변경 수준 |
|----------------|-----------|--------------|----------|
| **블록 스캐닝** | `getBlockByNumber(n); n++` | `getBlocks(start,end,"finalized")` + `getBlock(slot)` | 새로 구현 |
| **Reorg 감지** | parentHash RingBuffer, 되돌림 | finalized = reorg 없음, 방어적 RingBuffer | 단순화 |
| **Kafka/S3** | 메시지 발행 + S3 백업 | **동일** (메시지 포맷만 변경) | 포맷 변경 |
| **Transfer 추출** | Event log 파싱 (Transfer topic) | preBalances/postBalances diff | 새로 구현 |
| **Event Confirmer** | last_block - confirmation_blocks | **제거** (finalized = 이미 확정) | 제거 |
| **Checkpoint** | etcd에 block_number 저장 | etcd에 slot_number 저장 | 필드 변경 |

## 하위 문서

각 파이프라인 단계를 상세히 분석한다:

| # | 문서 | 핵심 질문 |
|---|------|----------|
| 01 | [결론: 스캐닝 방식만 변경](./01-conclusion-scanning-change/README.md) | 무엇이 바뀌고 무엇이 그대로인가? |
| 3.1 | [Slot/Block 모델 이해](./03-01-slot-block-model/README.md) | Solana의 시간 단위는 어떻게 다른가? |
| 3.2 | [블록 스캐닝 방식 비교](./03-02-block-scanning-comparison/README.md) | 코드 레벨에서 어떻게 다른가? |
| 3.3 | [Reorg 처리](./03-03-reorg-handling/README.md) | Reorg를 왜 걱정하지 않아도 되는가? |
| 3.4 | [Kafka/S3 적재](./03-04-kafka-s3-publishing/README.md) | 메시지 포맷이 어떻게 바뀌는가? |
| 3.5 | [Transfer 추출 방식 비교](./03-05-transfer-extraction/README.md) | Event log 대신 무엇을 파싱하는가? |
| 3.6 | [Event Confirmer](./03-06-event-confirmer/README.md) | 왜 이 단계가 필요 없어지는가? |

## 실행 가능한 코드

```bash
# Solana devnet에서 실제로 블록을 스캔하고 transfer를 추출하는 PoC
cd 03-q1-block-sync/code
npm install
npx tsx block-scanner.ts
```

코드 위치: [code/block-scanner.ts](./code/block-scanner.ts)

## 개발할 내용

1. `getSlot("finalized")`로 upper bound를 잡고 `getBlocks(start, end, "finalized")`로 빈 슬롯을 건너뛴다.
2. `getBlock` 호출 옵션을 고정한다: `encoding="jsonParsed"` 또는 `"json"`, `transactionDetails="full"`, `rewards=false`, `maxSupportedTransactionVersion=0`.
3. publisher checkpoint를 `block_number`가 아니라 `slot_number` 기준으로 저장한다.
4. consumer는 `meta.err != null` TX를 transfer 추출에서 제외한다.
5. `pre/postBalances`와 `pre/postTokenBalances` diff를 instruction index와 연결하는 extractor PoC를 만든다.

## 공부할 내용

1. `finalized` commitment의 의미와 `confirmed`/`processed`와의 차이를 학습한다.
2. 빈 슬롯, skipped slot, `block_height`와 `slot_number` 차이를 이해한다.
3. 대량 블록 싱크에서 HTTP RPC vs Geyser/Yellowstone trade-off를 조사한다.

## 완료 기준

- [ ] 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- [ ] 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- [ ] 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- [ ] 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 참고 링크

- [Solana Slots, Blocks, and Epochs (Helius)](https://www.helius.dev/blog/solana-slots-blocks-and-epochs)
- [Solana Commitment Levels (Helius)](https://www.helius.dev/blog/solana-commitment-levels)
- [Solana RPC HTTP Methods](https://solana.com/docs/rpc/http)
- [Add Solana to Your Exchange](https://solana.com/developers/guides/advanced/exchange)
- [Transaction Confirmation & Expiration](https://solana.com/developers/guides/advanced/confirmation)

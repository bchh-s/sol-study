# 10.5 RPC 프로바이더 비교

상위 섹션: [10. RPC API 레퍼런스](../README.md)

## 개요

Dagaon Core의 Solana 통합에 사용할 RPC 프로바이더를 비교한다. 프로바이더 선택은 성능, 비용, 기능 요구사항에 따라 달라진다.

---

## Alchemy

### 특성

| 항목 | 내용 |
|------|------|
| Solana 지원 | 50+ RPC 메서드 |
| Rate Limit | 300 RPS (shared node), 3000+ RPS (dedicated) |
| WebSocket | slotSubscribe, signatureSubscribe 등 지원 |
| blockSubscribe | **미지원** |
| gRPC/Geyser | **미지원** |
| Enhanced API | getPriorityFeeEstimate (향상된 priority fee 추정) |

### 가격 (2025년 기준)

| 플랜 | 가격 | Compute Units/월 | 비고 |
|------|------|-----------------|------|
| Free | $0 | 30M CU | 개발/테스트용 |
| Growth | $49/월 | 60M CU | 소규모 운영 |
| Scale | $199/월 | 200M CU | 중간 규모 |
| Enterprise | 협의 | 무제한 | 대규모 운영 |

### CU(Compute Unit) 소비 예시

```
getSlot:          1 CU
getBlock:         50~200 CU (블록 크기에 따라)
getBalance:       1 CU
sendTransaction:  50 CU
getSignatureStatuses: 1 CU per signature
```

### Dagaon Core 적합성

```
장점:
  - 안정적인 인프라 (멀티체인 경험)
  - EVM 이미 사용 중이면 통합 대시보드
  - enhanced priority fee API

단점:
  - blockSubscribe 미지원
  - gRPC 미지원 -> 대량 블록 싱크에 비효율
  - Solana 전문성이 Helius 대비 낮음
```

---

## Helius

### 특성

| 항목 | 내용 |
|------|------|
| Solana 전문 | Solana에 특화된 인프라 |
| Rate Limit | 플랜별 상이 (Free: 10 RPS, Business: 500+ RPS) |
| WebSocket | 전체 구독 지원 (blockSubscribe 포함) |
| gRPC/Geyser | **지원** (Yellowstone 기반) |
| DAS API | Digital Asset Standard API (NFT/cNFT 전용) |
| Enhanced TX API | 파싱된 TX 데이터 제공 |
| Webhooks | 주소 기반 이벤트 웹훅 |

### 가격 (2025년 기준)

| 플랜 | 가격 | Credits/일 | RPS | gRPC |
|------|------|-----------|-----|------|
| Free | $0 | 50K | 10 | 미지원 |
| Developer | $49/월 | 2M | 50 | 미지원 |
| Business | $499/월 | 20M | 500 | 지원 |
| Professional | $999/월 | 100M | 1000 | 지원 |
| Enterprise | 협의 | 무제한 | 무제한 | 지원 |

### Webhooks

```
HTTP POST 기반 이벤트 알림:

설정:
  - 모니터링할 주소 목록 등록
  - 이벤트 타입: TRANSFER, TOKEN_TRANSFER, NFT_TRANSFER, ...
  - webhook URL 지정

동작:
  해당 주소와 관련된 TX 발생 시 -> webhook URL로 POST 요청

Dagaon Core 활용:
  - deposit 지갑 목록을 webhook에 등록
  - 입금 발생 시 즉시 HTTP POST로 알림 수신
  - Block scan 없이 입금 감지 가능 (보조 수단으로 활용)
```

### gRPC/Geyser

```
Geyser plugin (Yellowstone):
  - 블록/TX/계정 변경을 gRPC 스트림으로 수신
  - HTTP RPC보다 10~50x 효율적 (바이너리 프로토콜, 스트리밍)
  - 대량 블록 싱크에 최적

Helius gRPC 사용:
  - Business 플랜 이상 필요
  - 별도 gRPC 엔드포인트 제공
  - Protobuf 기반 데이터 형식
```

### Dagaon Core 적합성

```
장점:
  - Solana 특화 인프라 (가장 최적화)
  - gRPC 지원 -> 대량 블록 싱크에 최적
  - Webhooks -> 입금 감지 보조
  - Enhanced TX API -> transfer 파싱 간소화
  - blockSubscribe 지원

단점:
  - Solana 전용 (다른 체인 미지원)
  - gRPC는 유료 플랜 필요
  - EVM과 별도 provider 관리
```

---

## QuickNode

### 특성

| 항목 | 내용 |
|------|------|
| 멀티체인 | 25+ 체인 지원 (Solana 포함) |
| Rate Limit | 플랜별 (Starter: 25 RPS, Pro: 100+ RPS) |
| WebSocket | 지원 |
| gRPC/Geyser | **지원** (add-on) |
| Marketplace | 다양한 add-on (NFT API, Token API 등) |

### 가격 (2025년 기준)

| 플랜 | 가격 | API Credits/월 | RPS |
|------|------|---------------|-----|
| Free | $0 | 50K | 10 |
| Starter | $49/월 | 5M | 25 |
| Growth | $299/월 | 30M | 100 |
| Business | $799/월 | 100M | 300 |
| Enterprise | 협의 | 무제한 | 커스텀 |

### Dagaon Core 적합성

```
장점:
  - 멀티체인 (EVM + Solana 한 곳에서)
  - gRPC add-on 지원
  - Marketplace로 기능 확장 용이

단점:
  - Solana 전문성이 Helius 대비 낮음
  - gRPC는 add-on (별도 과금)
  - 가격 대비 Helius가 Solana에 더 최적화
```

---

## 자체 호스팅 (Self-hosted)

### Agave Validator (전 Solana Labs validator)

```bash
# RPC 전용 노드 실행 (validator voting 없이)
agave-validator \
  --no-voting \
  --rpc-port 8899 \
  --rpc-bind-address 0.0.0.0 \
  --full-rpc-api \
  --enable-rpc-transaction-history \
  --rpc-pubsub-enable-block-subscription \
  --account-index program-id spl-token-owner \
  --known-validator dv1ZAGvdsz5hHLwWXsVnM94hWf1pjbKVau1QVkaMJ92 \
  --known-validator dv2eQHeP4RFUMftjJKJGH3T2G7kEfXxGJNJF1TjqPAq \
  --expected-genesis-hash 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d \
  --entrypoint entrypoint.mainnet-beta.solana.com:8001 \
  --entrypoint entrypoint2.mainnet-beta.solana.com:8001 \
  --limit-ledger-size 50000000 \
  --no-os-network-limits-test
```

### 하드웨어 요구사항

| 항목 | 최소 | 권장 |
|------|------|------|
| CPU | 16코어 (3.0GHz+) | 32코어 (3.5GHz+) |
| RAM | 256GB | 512GB |
| SSD | 2TB NVMe (PCIe Gen4) | 4TB NVMe RAID |
| 네트워크 | 1Gbps | 10Gbps |
| 월 비용 (클라우드) | $2,000+ | $4,000+ |

### Geyser Plugin (Yellowstone)

```
자체 노드에 Geyser plugin을 설치하면:
  - 모든 블록/TX/계정 변경을 gRPC로 스트리밍
  - RPC 호출 없이 데이터 수신
  - 가장 효율적인 블록 싱크 방법

설치:
  agave-validator ... --geyser-plugin-config config.json

config.json:
  {
    "libpath": "/path/to/libsolana_geyser_plugin_grpc.so",
    "grpc": {
      "address": "0.0.0.0:10000"
    }
  }
```

### Dagaon Core 적합성

```
장점:
  - 완전한 제어 (rate limit 없음)
  - Geyser plugin으로 최대 효율
  - 장기적으로 비용 절감 가능
  - blockSubscribe, 전체 히스토리 등 모든 기능 사용 가능

단점:
  - 초기 구축 비용 높음 (하드웨어 + 운영)
  - ledger sync에 수일 소요 (초기 셋업)
  - 운영 인력 필요 (업데이트, 모니터링)
  - mainnet 노드는 높은 하드웨어 사양 필요
```

---

## gRPC / Yellowstone (대량 블록 싱크 최적 방법)

HTTP RPC 대비 gRPC의 장점:

```
HTTP RPC로 블록 싱크:
  1. getSlot() -> 현재 슬롯
  2. getBlocks(start, end) -> 슬롯 목록
  3. for each slot: getBlock(slot) -> 블록 데이터
  -> 슬롯당 1 RPC 호출, JSON 파싱 오버헤드

gRPC (Yellowstone):
  1. subscribe(blocks, finalized) -> 스트림 시작
  2. 블록이 finalized될 때마다 자동 push
  -> 폴링 없음, 바이너리 프로토콜 (protobuf), 낮은 지연시간

성능 비교:
  HTTP RPC: ~100 blocks/sec (rate limit + JSON overhead)
  gRPC:     ~1000+ blocks/sec (no rate limit, protobuf)
```

### Dagaon Core에서의 점진적 전환

```
Phase 1 (초기):
  - HTTP RPC (Helius 또는 Alchemy)
  - 구현이 간단하고 빠른 시작
  - catch-up 싱크에 수시간~수일 소요 가능

Phase 2 (운영 안정화 후):
  - 부하 측정 후 gRPC 전환 기준 수치화
  - 기준: HTTP RPC rate limit 70%+ 도달, 또는 싱크 지연 > 30초

Phase 3 (대규모 운영):
  - Helius gRPC 또는 자체 노드 + Geyser
  - Block Publisher를 gRPC 스트림 기반으로 전환
```

---

## 의사결정 매트릭스: Dagaon Core 권장

| 기준 | 가중치 | Alchemy | Helius | QuickNode | 자체노드 |
|------|-------|---------|--------|-----------|---------|
| Solana 전문성 | 25% | 6/10 | **10/10** | 7/10 | 10/10 |
| gRPC 지원 | 20% | 0/10 | **9/10** | 7/10 | 10/10 |
| 비용 효율 (초기) | 20% | 7/10 | **8/10** | 6/10 | 2/10 |
| 운영 편의성 | 15% | **9/10** | 8/10 | 8/10 | 3/10 |
| EVM 통합 | 10% | **10/10** | 0/10 | 8/10 | 5/10 |
| 확장성 | 10% | 7/10 | **9/10** | 7/10 | 10/10 |
| **총점** | | **6.25** | **8.05** | **6.75** | **6.15** |

### 권장안

```
1순위: Helius (Business 플랜)
  - Solana 특화, gRPC 지원, 합리적 비용
  - 초기 개발부터 대량 운영까지 커버
  - Webhook으로 입금 감지 보조 가능

2순위: Alchemy (EVM과 통합 관리가 중요한 경우)
  - 이미 EVM에서 Alchemy 사용 중이면 관리 편의
  - gRPC 미지원이므로 대량 싱크 시 한계

3순위: 자체 노드 + Geyser (대규모 운영, Phase 3)
  - mainnet 일일 100만+ TX 처리 시
  - rate limit 완전 제거
  - 초기 투자/운영 비용 고려

구성 예시 (권장):
  Primary: Helius (Business)
  Secondary (failover): Alchemy 또는 QuickNode
  Phase 3: 자체 노드 + Geyser (primary), Helius (fallback)
```

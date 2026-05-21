# 11. 리스크 평가

## 개요

Dagaon Core에 Solana 체인을 통합할 때 발생할 수 있는 기술 리스크를 체계적으로 평가한다. EVM 체인과의 근본적인 아키텍처 차이에서 비롯되는 리스크를 식별하고, 각각에 대해 발생 확률, 영향도, 완화 전략, 탐지 방법, 복구 절차를 정의한다.

## 리스크 평가 방법론

### 평가 프레임워크

각 리스크는 다음 두 축으로 평가한다:

- **발생 확률(Probability):** 해당 리스크가 프로덕션 환경에서 실제로 발생할 가능성
- **영향도(Impact):** 발생 시 시스템 운영과 사용자 자산에 미치는 피해 정도

### 리스크 매트릭스: 확률 x 영향도

```
영향도 ↑
         ┌──────────┬──────────┬──────────┐
  HIGH   │ MEDIUM   │  HIGH    │ CRITICAL │
         │          │          │          │
         ├──────────┼──────────┼──────────┤
  MEDIUM │ LOW      │  MEDIUM  │  HIGH    │
         │          │          │          │
         ├──────────┼──────────┼──────────┤
  LOW    │ LOW      │  LOW     │  MEDIUM  │
         │          │          │          │
         └──────────┴──────────┴──────────┘
          LOW        MEDIUM     HIGH
                              확률 →
```

### 등급별 대응 원칙

| 등급 | 대응 | 모니터링 주기 | 예시 |
|------|------|--------------|------|
| **CRITICAL** | 구현 전 반드시 해결, 설계에 반영 | 실시간 | - |
| **HIGH** | Phase 1-2에서 완화 전략 구현 | 실시간 + 알림 | TX 드롭, 블록 볼륨 |
| **MEDIUM** | Phase 3에서 처리, 운영 절차 수립 | 주기적 체크 | ATA 비용, 실패 TX 회계 |
| **LOW** | 표준 구현으로 충분, 방어적 코드 | 이벤트 기반 | KMS 통합, reorg |

## 전체 리스크 요약

### 심각도별 리스크 목록

| # | 리스크 | 확률 | 영향도 | 종합 등급 | 관련 컴포넌트 |
|---|--------|------|--------|----------|--------------|
| 1 | TX 랜딩 안정성 | HIGH | HIGH | **HIGH** | tx-sender, tx-monitor |
| 2 | Durable Nonce 풀 고갈 | MEDIUM | HIGH | **HIGH** | tx-preparer, nonce-manager |
| 3 | 블록 데이터 볼륨 | HIGH | MEDIUM | **HIGH** | block-publisher, block-consumer |
| 4 | ATA 라이프사이클 관리 | MEDIUM | MEDIUM | **MEDIUM** | tx-preparer, account-manager |
| 5 | 실패 TX 수수료 회계 | MEDIUM | LOW | **MEDIUM** | tx-monitor, accounting |
| 6 | 주소 포맷 전환 | LOW | MEDIUM | **MEDIUM** | 전체 스택 (DB, API, UI) |
| 7 | KMS 통합 | LOW | LOW | **LOW** | kms-signer |
| 8 | Finalized 레벨 Reorg | LOW | LOW | **LOW** | block-publisher |

### EVM 대비 리스크 비교

EVM 체인에서는 mempool이 존재하여 트랜잭션이 한번 제출되면 어딘가에는 보관되지만, Solana에서는 mempool이 없어 리더 노드에 직접 전달되므로 TX 드롭 리스크가 근본적으로 다르다. 반면 reorg 리스크는 EVM보다 Solana가 압도적으로 낮다. 즉, **"TX가 체인에 포함되기까지"의 리스크는 높아지고, "포함된 후 번복될" 리스크는 사실상 없어진다.**

### 핵심 운영 지표 정의

| 지표 | 설명 | 알림 기준 | 수집 방법 |
|------|------|----------|----------|
| `tx_landing_rate` | 전송 대비 확정 비율 | < 95% (warn), < 80% (critical) | tx-sender 성공/실패 카운터 |
| `tx_resend_count` | TX당 평균 재전송 횟수 | > 5 (warn), > 10 (critical) | tx-sender 재시도 카운터 |
| `time_to_finalized` | 전송 ~ finalized 확인 소요 시간 | > 30s (warn), > 60s (critical) | tx-monitor 타임스탬프 차이 |
| `nonce_pool_utilization` | 사용 중인 nonce / 전체 nonce | > 80% (warn), > 95% (critical) | nonce-manager 상태 조회 |
| `publisher_lag_slots` | 최신 finalized slot - 마지막 처리 slot | > 10 (warn), > 50 (critical) | block-publisher 메트릭 |
| `rpc_error_rate` | RPC 호출 실패 비율 | > 5% (warn), > 15% (critical) | RPC client wrapper |

## 하위 상세 문서

- [높은 리스크 (Risk 1-3)](./01-high-risks/README.md) -- TX 랜딩, Nonce 풀, 블록 볼륨
- [중간 리스크 (Risk 4-6)](./02-medium-risks/README.md) -- ATA 관리, 실패 TX 회계, 주소 포맷
- [낮은 리스크 (Risk 7-8)](./03-low-risks/README.md) -- KMS 통합, Reorg

## 참고 링크

- [Solana Transactions](https://solana.com/docs/core/transactions)
- [Solana Fees](https://solana.com/docs/core/fees)
- [Durable Nonces](https://solana.com/docs/core/transactions/durable-nonces)
- [Transaction Confirmation & Expiration](https://solana.com/developers/guides/advanced/confirmation)
- [Retrying Transactions](https://solana.com/developers/guides/advanced/retry)
- [How to Land Transactions on Solana - Helius](https://www.helius.dev/blog/how-to-land-transactions-on-solana)

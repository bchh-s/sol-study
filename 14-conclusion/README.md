# 14. 결론

## 통합 가능성 요약

Dagaon Core에 Solana 체인을 통합하는 것은 **기술적으로 실현 가능하며, 기존 아키텍처의 60-70%를 재사용할 수 있다.** Solana의 근본적인 차이(mempool 부재, 슬롯 기반 블록, balance diff 기반 전송 감지, Ed25519 서명)는 새로운 구현이 필요하지만, Dagaon Core의 플러그인 아키텍처 덕분에 기존 EVM 파이프라인에 영향을 주지 않고 독립적으로 추가할 수 있다.

## 핵심 판단

| 영역 | 판단 | 근거 |
|------|------|------|
| 인프라 재사용 | **높음** | Kafka/S3, etcd HA, Plugin registry는 체인 무관 |
| KMS 통합 | **가능** | AWS KMS Ed25519 GA (2025.11), 라이브러리 존재 |
| 입금 파이프라인 | **단순화** | finalized commitment → Event Confirmer 불필요, ~13초 확정 |
| 출금 파이프라인 | **복잡성 증가** | durable nonce 풀 관리, 재전송 루프 등 새로운 운영 패턴 |
| 데이터 볼륨 | **주의 필요** | EVM 대비 100x+ TPS, gRPC/Geyser 또는 필터링 전략 필수 |
| 리스크 | **관리 가능** | HIGH 리스크 3건 모두 알려진 완화 전략 존재 |

## Solana 통합의 본질

이 프로젝트는 **EVM 확장이 아니라 새로운 체인 어댑터 추가**이다. 공유할 수 있는 인프라는 최대한 재사용하되, 체인별 차이는 전용 컴포넌트로 처리한다. 이 관점이 설계 전반에 일관되게 적용되어야 한다.

```
Dagaon Core 아키텍처:

                    ┌─────────────────────┐
                    │   공통 인프라 레이어    │
                    │  Kafka / S3 / etcd   │
                    │  KMS / Plugin Reg.   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────┴──────┐ ┌──────┴──────┐  ┌──────┴──────┐
    │  EVM Adapter   │ │ Solana Adpt │  │ Future Chain│
    │ Block Publisher│ │ Slot Scanner│  │   Adapter   │
    │ Event Log 추출 │ │ Balance Diff│  │     ...     │
    │ Event Confirmer│ │ (Confirmer  │  │             │
    │ Nonce 관리     │ │  생략)      │  │             │
    │ Gas 관리       │ │ Nonce Pool  │  │             │
    └────────────────┘ └─────────────┘  └─────────────┘
```

## 투자 대비 효과

| 투자 | 효과 |
|------|------|
| 12주 개발 | SOL + 모든 SPL 토큰 지원 |
| ~0.5 SOL 초기 비용 | nonce 풀(환불 가능) + ATA 비용 |
| 5-6개 새 DB 테이블 | 기존 EVM 무영향 |
| 새 운영 패턴 학습 | 향후 non-EVM 체인 추가 기반 마련 |

## 다음 단계: 즉시 시작할 3개 Spike

1. **KMS Ed25519 Signing PoC** -- devnet에서 KMS 서명으로 SOL 전송 (1-2일)
2. **Finalized Block Scan PoC** -- devnet에서 finalized 슬롯 스캔 + 전송 추출 (1-2일)
3. **Durable Nonce Withdrawal PoC** -- devnet에서 nonce 생성 → TX 구성 → 전송 (2-3일)

이 세 가지 spike가 모두 성공하면 Phase 1 본격 착수.

## 하위 상세 분석

- [재사용 가능한 것](./01-reusable-components/README.md) -- 기존 Dagaon Core에서 그대로 쓸 수 있는 컴포넌트
- [새로 구현해야 하는 것](./02-new-components/README.md) -- Solana 전용으로 새로 만들어야 하는 컴포넌트
- [오히려 좋아지는 것](./03-improvements/README.md) -- Solana에서 EVM보다 나아지는 영역

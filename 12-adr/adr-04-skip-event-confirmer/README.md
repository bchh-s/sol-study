# ADR-4: Event Confirmer 생략

상위 섹션: [12. Architecture Decision Records](../README.md)

---

## 상태

**Accepted** (2026-05)

## 맥락 (Context)

Dagaon Core의 EVM 입금 파이프라인은 5단계로 구성되어 있다:

```
EVM 파이프라인 (5단계):
1. Block Publisher    → 블록 수집 (latest)
2. Block Consumer     → 이벤트 추출 (Transfer 로그 등)
3. Event Confirmer    → N개 confirmation 대기 (reorg 방어)
4. Deposit Creditor   → 입금 확정 및 잔액 반영
5. Notification       → 사용자 알림
```

Event Confirmer의 역할:
- 추출된 이벤트의 confirmation 수를 추적
- 목표 confirmation(예: 15)에 도달하면 이벤트를 "confirmed"로 표시
- Reorg 발생 시 해당 블록의 이벤트를 취소

Solana에서 `finalized` commitment으로 블록을 읽으면(ADR-1), 이미 최종성이 보장된 데이터만 수신한다. 이 경우 Event Confirmer의 "confirmation 대기" 역할이 무의미하다.

## 결정 (Decision)

**Solana 파이프라인에서 Event Confirmer 단계를 생략한다. finalized commitment에서 추출된 이벤트는 즉시 confirmed로 처리한다.**

```
Solana 파이프라인 (4단계):
1. Block Publisher    → finalized 슬롯 수집
2. Block Consumer     → 전송 이벤트 추출 (balance diff)
3. Deposit Creditor   → 입금 확정 및 잔액 반영 (즉시)
4. Notification       → 사용자 알림
```

## 근거 (Rationale)

### 1. finalized = 최종 확정

ADR-1에서 결정한 대로 `finalized` commitment에서만 데이터를 읽는다. 이 수준의 블록은:
- 전체 스테이크의 2/3+ 투표 완료
- 지수적 lockout 적용
- 역사상 reorg 0건

따라서 추가 confirmation 대기는 불필요하다.

### 2. 불필요한 지연 제거

```
EVM:
  블록 수집 → 이벤트 추출 → [Event Confirmer: 15 conf x 12초 = ~3분 대기] → 입금 확정
  총 지연: ~3-5분

Solana (Confirmer 유지 시):
  슬롯 수집 (finalized, ~13초) → 이벤트 추출 → [Event Confirmer: 0 conf 대기?] → 입금 확정
  총 지연: ~13초 + Confirmer 오버헤드

Solana (Confirmer 생략 시):
  슬롯 수집 (finalized, ~13초) → 이벤트 추출 → 입금 확정 (즉시)
  총 지연: ~13초
```

Event Confirmer를 유지하더라도 confirmation threshold을 0으로 설정해야 하므로, 실질적으로 pass-through가 되어 불필요한 오버헤드만 추가한다.

### 3. 상태 관리 복잡성 제거

Event Confirmer는 다음과 같은 상태를 관리한다:

```
EVM Event Confirmer 상태 관리:
- pending_events: 아직 N confirmation에 도달하지 않은 이벤트 목록
- confirmation_count: 이벤트별 현재 confirmation 수
- reorg_detection: 블록 해시 변경 감지 시 이벤트 취소
- 배치 처리: N개 confirmation 도달한 이벤트를 일괄 확정

Solana에서 이 모든 것이 불필요:
- pending_events: 없음 (즉시 확정)
- confirmation_count: 없음 (finalized = 확정)
- reorg_detection: previousBlockhash 검증으로 충분 (Risk 8 참조)
- 배치 처리: Block Consumer에서 바로 확정
```

### 4. 장애 포인트 감소

파이프라인 단계가 줄어들면:
- 장애가 발생할 수 있는 컴포넌트 1개 감소
- Kafka 토픽 1개 감소 (Confirmer → Creditor 사이 토픽)
- 모니터링 대상 1개 감소
- 디버깅 시 추적해야 할 경로 단순화

## 대안 검토 (Alternatives Considered)

### 대안 1: Event Confirmer 유지 (threshold = 0)

```
전략:
- Event Confirmer를 유지하되, Solana용 threshold을 0으로 설정
- 이벤트가 Confirmer에 도달하면 즉시 통과 (pass-through)

장점:
- EVM과 동일한 파이프라인 구조 유지
- 나중에 threshold을 변경할 수 있는 유연성

단점:
- 하는 일 없는 컴포넌트가 파이프라인에 존재 → 혼란
- Kafka 토픽, 모니터링, 배포 대상 증가 (이유 없이)
- "왜 Confirmer가 있는데 0-confirmation인가?" → 아키텍처 의도가 불명확
- 유연성 주장: finalized에서 reorg가 발생하기 시작한다면 Solana 네트워크 자체의 문제이며,
  Confirmer를 다시 추가하는 것보다 근본적인 대응이 필요

폐기 이유: 불필요한 추상화. 코드가 아닌 아키텍처 문서로 "필요 시 추가 가능"을 기록하면 충분.
```

### 대안 2: confirmed로 읽고 Confirmer에서 finalized 대기

```
전략:
- Block Publisher가 confirmed 수준에서 블록 수집
- Event Confirmer가 finalized까지 대기

장점:
- EVM과 완전히 동일한 패턴

단점:
- confirmed → finalized 사이에 reorg 발생 시 처리 로직 필요 (극히 드물지만)
- 결과적으로 finalized까지 기다리므로 latency 이점 없음
- 불필요한 복잡성

폐기 이유: ADR-1에서 이미 finalized 전용으로 결정. 이 대안은 ADR-1과 충돌.
```

## 결과 (Consequences)

### 긍정적 결과

- **파이프라인 단순화:** 5단계 → 4단계
- **지연 감소:** Confirmer 통과 오버헤드 제거
- **운영 단순화:** 모니터링 대상, Kafka 토픽, 배포 대상 감소
- **코드 단순화:** Solana 플러그인에서 Confirmer 관련 코드 불필요
- **상태 관리 감소:** pending confirmation 목록 관리 불필요

### 부정적 결과 (수용한 trade-off)

- **체인별 파이프라인 구조 차이:** EVM은 5단계, Solana는 4단계 → 체인별 플러그인 분리가 이미 전제이므로 수용 가능
- **통합 모니터링 복잡:** 체인별 파이프라인 단계가 다르므로 대시보드 분리 필요 → 어차피 체인별 메트릭은 분리해야 함
- **나중에 Confirmer 필요 시:** 새로 추가해야 함 → 가능성 극히 낮으며, 필요 시 추가 비용은 크지 않음

## EVM/Solana 파이프라인 비교 요약

```
EVM 입금 파이프라인:
  Block Publisher → Block Consumer → Event Confirmer → Deposit Creditor → Notification
  [latest block]   [event log 추출]  [15 conf 대기]    [잔액 반영]        [알림]
      ~0초              ~1초           ~3-5분            ~1초              ~1초
                                   총: ~3-5분

Solana 입금 파이프라인:
  Block Publisher → Block Consumer → Deposit Creditor → Notification
  [finalized slot]  [balance diff]   [잔액 반영 즉시]     [알림]
      ~13초             ~1초             ~1초              ~1초
                                   총: ~16초
```

## 참고 자료

- [ADR-1: 입금 Commitment Level](../adr-01-deposit-commitment/README.md) -- finalized 전용 결정
- [Risk 8: Finalized 레벨 Reorg](../../11-risk-assessment/03-low-risks/README.md) -- reorg 리스크 분석
- [Solana Commitment Levels - Helius](https://www.helius.dev/blog/solana-commitment-levels)

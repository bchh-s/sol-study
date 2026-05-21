# ADR-1: 입금 Commitment Level

상위 섹션: [12. Architecture Decision Records](../README.md)

---

## 상태

**Accepted** (2026-05)

## 맥락 (Context)

Dagaon Core에 Solana 입금 파이프라인을 추가할 때, 블록(슬롯) 데이터를 어떤 commitment level에서 읽어야 하는지 결정해야 한다.

Solana는 3가지 commitment level을 제공한다:

| Commitment | 의미 | 지연 | Reorg 가능성 |
|-----------|------|------|-------------|
| `processed` | 현재 노드가 처리한 블록 | ~400ms | 높음 (아직 투표 전) |
| `confirmed` | 슈퍼다수(2/3+) 투표를 받은 블록 | ~1-2초 | 이론적으로 가능 (극히 낮음) |
| `finalized` | 슈퍼다수 투표 + lockout 만료 | ~13초 | 사실상 불가능 |

기존 EVM 파이프라인에서는 블록을 즉시 읽되, Event Confirmer 단계에서 N개의 confirmation을 대기하여 reorg 리스크를 완화한다:

```
EVM 파이프라인:
Block Publisher → Block Consumer → Event Confirmer (15 conf 대기) → 입금 확정
                                        ↑
                                   3-5분 지연
```

Solana에서는 commitment level 선택으로 이 과정을 단순화할 수 있다.

## 결정 (Decision)

**`finalized` commitment만 사용하여 입금을 확정한다.**

Block Publisher는 `getBlocks`와 `getBlock` 호출 시 `commitment: "finalized"`를 사용하며, 이 수준에서 읽은 트랜잭션은 추가 확인 없이 즉시 입금으로 확정한다.

```
Solana 파이프라인:
Block Publisher (finalized) → Block Consumer → 입금 확정 (즉시)
                                                    ↑
                                              Event Confirmer 불필요
```

## 근거 (Rationale)

### 1. Reorg 리스크 완전 제거

`finalized` commitment의 블록은 전체 스테이크의 2/3 이상이 투표하고, 지수적 lockout이 적용된 상태이다. Solana 역사상 finalized 블록의 reorg는 단 한 건도 관측된 적 없다. 이는 "사실상 불가능"을 넘어 "역사적으로 발생하지 않음"이다.

### 2. 지연 시간이 EVM보다 오히려 빠름

```
EVM 입금 확정 시간:
  블록 생성(~12초) x 15 confirmation = ~3-5분

Solana finalized 입금 확정 시간:
  ~13초 (슬롯 생성 ~ finalized 도달)

결론: Solana finalized가 EVM 15-confirmation보다 10-20배 빠름
```

### 3. 파이프라인 단순화

Event Confirmer 단계를 제거하면:
- 파이프라인 단계가 5단계 → 4단계로 줄어듦
- Confirmer의 상태 관리(pending confirmation 목록, confirmation 카운트 추적) 불필요
- 장애 포인트 1개 감소
- 코드 복잡도 감소

### 4. 공식 가이드 권장

Solana의 [Add Solana to Your Exchange](https://solana.com/developers/guides/advanced/exchange) 가이드에서도 거래소 통합 시 `finalized` commitment 사용을 명시적으로 권장한다.

## 대안 검토 (Alternatives Considered)

### 대안 1: `confirmed` commitment 사용

```
장점:
- ~1-2초로 finalized(~13초)보다 ~11초 빠름

단점:
- 이론적 reorg 가능성 존재 (극히 낮지만 0이 아님)
- 거래소에서 "입금 확정 후 reorg로 TX 사라짐" → 이중 지불
- 11초의 속도 이점이 reorg 리스크를 정당화하지 못함
- 빠른 입금이 필요하면 UI에서 "대기 중" 상태를 먼저 표시 가능

폐기 이유: 리스크 대비 이점이 불충분. 13초도 충분히 빠름.
```

### 대안 2: `processed` commitment 사용

```
장점:
- ~400ms로 가장 빠름

단점:
- reorg 가능성이 실질적으로 존재
- 합의 전 상태이므로 다른 노드에서는 다른 결과를 볼 수 있음
- 거래소 입금에 사용할 수 없는 수준의 안전성

폐기 이유: 입금 확정에 사용하기에 근본적으로 부적합.
```

### 대안 3: `confirmed`로 읽되 Event Confirmer에서 finalized 대기

```
장점:
- EVM과 동일한 파이프라인 구조 유지

단점:
- 불필요한 복잡성 (confirmed → finalized 사이에 reorg 발생 시 처리 로직 필요)
- Event Confirmer가 하는 일이 없음 (finalized 대기만)
- 지연 시간은 결국 finalized와 동일 (~13초)

폐기 이유: 복잡성만 추가하고 실질적 이점 없음.
```

## 결과 (Consequences)

### 긍정적 결과

- **Reorg 리스크 0:** finalized commitment에서 읽으므로 reorg 대응 로직 불필요
- **파이프라인 단순화:** Event Confirmer 단계 제거 → 4단계 파이프라인
- **빠른 확정:** EVM의 3-5분 대비 ~13초로 입금 확정
- **운영 단순화:** confirmation 카운트 추적, pending confirmation 상태 관리 불필요

### 부정적 결과 (수용한 trade-off)

- **`confirmed` 대비 ~11초 추가 지연:** 13초 vs 2초. 그러나 13초도 EVM보다 충분히 빠르므로 수용 가능
- **EVM과 다른 파이프라인 구조:** 체인별로 파이프라인 단계 수가 다름. 그러나 이미 체인별 플러그인 분리가 전제이므로 문제없음
- **빈 슬롯 처리 필요:** finalized 슬롯 중 빈 슬롯(리더가 블록 미생산)이 있으므로, getBlock 호출 시 null 응답 처리 필요

## 구현 영향

| 컴포넌트 | 변경 사항 |
|---------|----------|
| Block Publisher | `getBlocks(startSlot, endSlot, { commitment: "finalized" })` 사용 |
| Block Consumer | 수신 블록을 즉시 확정 처리 (confirmation 대기 없음) |
| Event Confirmer | **Solana에서 불필요** (ADR-4 참조) |
| DB | `solana_transfers.status`에 `PENDING_CONFIRMATION` 상태 불필요 |

## 참고 자료

- [Solana Commitment Levels - Helius](https://www.helius.dev/blog/solana-commitment-levels)
- [Transaction Confirmation & Expiration](https://solana.com/developers/guides/advanced/confirmation)
- [Add Solana to Your Exchange](https://solana.com/developers/guides/advanced/exchange)

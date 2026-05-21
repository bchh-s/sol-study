# 12. Architecture Decision Records

## ADR이란?

Architecture Decision Record(ADR)는 소프트웨어 아키텍처에서 내린 중요한 결정과 그 맥락, 근거, 결과를 기록하는 문서이다. 시간이 지나면 "왜 이렇게 결정했는가?"를 잊기 쉬운데, ADR은 이 맥락을 보존하여 미래의 팀원(또는 미래의 자신)이 결정의 배경을 이해하고, 상황이 변했을 때 재검토할 수 있게 한다.

## 왜 ADR을 쓰는가

Solana 통합 프로젝트에서 ADR이 특히 중요한 이유:

1. **EVM과의 근본적 차이:** "왜 EVM과 다르게 했는가?"에 대한 답을 기록
2. **Trade-off의 명시적 기록:** 모든 결정에는 장단점이 있으며, 왜 특정 trade-off를 수용했는지 기록
3. **대안 폐기 근거:** 검토했으나 채택하지 않은 대안과 그 이유를 기록하여 같은 논의 반복 방지
4. **변경 이력:** 나중에 결정이 바뀌면 `Superseded by ADR-N` 링크로 추적

## ADR 템플릿 구조

```markdown
# ADR-N: [결정 제목]

## 상태
[Proposed | Accepted | Deprecated | Superseded by ADR-N]

## 맥락 (Context)
이 결정이 필요한 배경. 어떤 문제를 해결해야 하는가?

## 결정 (Decision)
무엇을 하기로 결정했는가? 핵심을 간결하게.

## 근거 (Rationale)
왜 이 결정을 내렸는가? 기술적 근거, 데이터, 참조 문서.

## 대안 검토 (Alternatives Considered)
검토했으나 채택하지 않은 대안과 폐기 이유.

## 결과 (Consequences)
### 긍정적 결과
### 부정적 결과 (수용한 trade-off)

## 참고 자료
관련 문서, 코드, 외부 링크.
```

## 리뷰 체크리스트

ADR 작성 후 다음 항목을 검토한다:

- [ ] 결정이 명확하고 모호하지 않은가?
- [ ] 맥락에서 문제 상황이 충분히 설명되었는가?
- [ ] 최소 2개 이상의 대안이 검토되었는가?
- [ ] 각 대안의 폐기 근거가 구체적인가?
- [ ] 긍정적/부정적 결과가 모두 명시되었는가?
- [ ] 관련 공식 문서나 데이터로 근거를 뒷받침하는가?
- [ ] EVM 현재 구현과의 차이가 설명되었는가?

## ADR 목록

| ADR | 제목 | 상태 | 핵심 결정 |
|-----|------|------|----------|
| [ADR-1](./adr-01-deposit-commitment/README.md) | 입금 Commitment Level | Accepted | `finalized` commitment만 사용 |
| [ADR-2](./adr-02-withdrawal-durable-nonce/README.md) | 출금 Durable Nonce | Accepted | 모든 출금에 durable nonce 사용 |
| [ADR-3](./adr-03-db-table-separation/README.md) | DB 테이블 분리 | Accepted | Solana 전용 테이블 생성 |
| [ADR-4](./adr-04-skip-event-confirmer/README.md) | Event Confirmer 생략 | Accepted | Solana에서 Event Confirmer 단계 제거 |

## 참고 링크

- [Solana Transaction Confirmation & Expiration](https://solana.com/developers/guides/advanced/confirmation)
- [Solana Durable Nonces](https://solana.com/docs/core/transactions/durable-nonces)
- [Add Solana to Your Exchange](https://solana.com/developers/guides/advanced/exchange)
- [Retrying Transactions](https://solana.com/developers/guides/advanced/retry)

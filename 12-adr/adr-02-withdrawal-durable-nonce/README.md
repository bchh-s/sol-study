# ADR-2: 출금 Durable Nonce

상위 섹션: [12. Architecture Decision Records](../README.md)

---

## 상태

**Accepted** (2026-05)

## 맥락 (Context)

Solana 트랜잭션에는 recent blockhash가 포함되어야 하며, 이 blockhash는 약 150블록(~60-90초) 후 만료된다. 만료된 blockhash를 포함한 TX는 네트워크에서 거부된다.

Dagaon Core의 출금 파이프라인은 다음 단계를 거친다:

```
출금 요청 → TX 구성(tx-preparer) → KMS 서명(tx-signer) → 정책 승인 → TX 전송(tx-sender)
```

이 파이프라인에서 각 단계의 예상 소요 시간:

| 단계 | 소요 시간 | 비고 |
|------|----------|------|
| TX 구성 | ~1초 | RPC 호출 포함 |
| KMS 서명 | ~50-200ms | AWS KMS API 호출 |
| 정책 승인 | **0초 ~ 수 시간** | 자동 승인 또는 수동 승인 대기 |
| TX 전송 | ~1-30초 | 재전송 루프 포함 |

**문제: 정책 승인 단계에서 수동 승인이 필요한 경우, recent blockhash가 만료되어 TX가 무효화된다.** TX를 재구성하면 서명도 다시 받아야 하므로 전체 파이프라인을 처음부터 반복해야 한다.

EVM에서는 이 문제가 없다. EVM의 nonce는 계정 기반 순차 번호로, 만료 개념이 없다. 한번 서명한 TX를 며칠 후에 전송해도 유효하다 (nonce가 아직 사용되지 않았다면).

## 결정 (Decision)

**모든 출금 트랜잭션에 durable nonce를 사용한다.**

Recent blockhash 대신 durable nonce 계정의 nonce 값을 blockhash 필드에 넣어 TX를 구성한다. Durable nonce는 명시적으로 advance하기 전까지 만료되지 않는다.

```
TX 구성:
1. nonce pool에서 사용 가능한 nonce 계정 할당
2. nonce 계정의 현재 nonce 값 조회 (getNonce)
3. TX의 blockhash 필드에 nonce 값 설정
4. TX의 첫 번째 instruction으로 SystemProgram.nonceAdvance 추가
5. KMS 서명 → 정책 승인 → 전송 (시간 제한 없음)
```

## 근거 (Rationale)

### 1. 만료 없는 TX 유효 기간

```
recent blockhash:
  TX 구성 → (60-90초 내에 전송해야 함) → 전송
  만료 시: TX 무효 → 재구성 + 재서명 필요

durable nonce:
  TX 구성 → (시간 제한 없음) → 승인 대기 → 전송
  nonce advance 전까지 TX는 항상 유효
```

### 2. 결정적 취소 메커니즘

Durable nonce를 사용하면 TX 취소가 결정적(deterministic)이다:

```
TX 취소 방법:
  1. nonceAdvance(nonce_account) TX 전송
  2. nonce 값이 변경됨
  3. 이전 nonce 값으로 서명된 TX는 자동으로 무효화
  4. 이전 TX가 나중에 처리될 가능성 = 0

EVM에서의 TX 취소:
  동일 nonce + 높은 gas price로 빈 TX 전송
  → 원래 TX가 먼저 처리될 가능성이 (작지만) 존재
  → 취소가 비결정적
```

### 3. KMS 서명 파이프라인과의 호환

```
서명 후 임의 시간 대기 가능:
  tx-preparer: TX 구성 (nonce 할당)
       ↓
  tx-signer: KMS Ed25519 서명 (50-200ms)
       ↓
  정책 승인: 자동(0초) 또는 수동(수 시간)
       ↓
  tx-sender: TX 전송 (nonce가 아직 유효하므로 문제없음)

서명은 한 번만 하면 됨 → KMS 호출 횟수 최소화 → 비용 절감
```

## 대안 검토 (Alternatives Considered)

### 대안 1: Recent Blockhash + Fast Path

```
전략:
- TX 구성 → 즉시 서명 → 즉시 전송 (60초 이내 완료)
- 정책 승인은 TX 구성 전에 미리 수행

장점:
- durable nonce 관리 복잡성 없음

단점:
- 정책 승인을 TX 구성 전에 완료해야 함 → 승인 시점에 최종 TX 내용(금액, 수신자)을 알 수 없음
- 수동 승인이 필요한 대량 출금 처리 불가
- 네트워크 혼잡 시 60초 내 전송 실패 가능성 → TX 무효화 → 전체 재시작
- KMS 장애나 지연 시 blockhash 만료 리스크

폐기 이유: 정책 승인 단계의 유연성을 포기할 수 없음. 네트워크 혼잡 시 60초 제한이 운영 리스크.
```

### 대안 2: 하이브리드 접근 (자동 승인 = recent blockhash, 수동 승인 = durable nonce)

```
전략:
- 소액 자동 승인: recent blockhash (더 단순)
- 대량 수동 승인: durable nonce (만료 없음)

장점:
- 소액 출금은 nonce 풀 관리 불필요

단점:
- 두 가지 TX 구성/전송 경로를 모두 구현해야 함 → 코드 복잡성 2배
- "소액"과 "대량"의 기준 관리 필요
- 자동 승인 경로에서도 혼잡 시 60초 만료 문제 발생 가능
- 모니터링/디버깅 복잡성 증가

폐기 이유: 불필요한 복잡성. Durable nonce가 모든 시나리오를 커버하므로 단일 경로로 통일하는 것이 유지보수에 유리.
```

## 결과 (Consequences)

### 긍정적 결과

- **만료 없는 TX:** 승인 대기 시간에 무관하게 TX 유효
- **결정적 취소:** nonce advance로 확실한 TX 취소
- **단일 서명:** TX 재구성/재서명 불필요 → KMS 호출 최소화
- **단일 코드 경로:** 모든 출금이 동일한 플로우

### 부정적 결과 (수용한 trade-off)

- **Nonce 풀 관리 복잡성:** 사전 할당, 동적 확장, STUCK 해제 등 운영 로직 필요 (Risk 2 참조)
- **비용:** 100개 nonce 계정 × 0.0015 SOL = ~0.15 SOL (환불 가능, 미미한 비용)
- **TX 첫 번째 instruction 제약:** nonceAdvance가 반드시 첫 번째 instruction이어야 함 → TX 구성 시 순서 주의
- **Nonce 계정 조회 오버헤드:** TX 구성 시 nonce 값을 조회하는 RPC 호출 1회 추가

### Nonce 풀 운영 요약

| 항목 | 값 |
|------|-----|
| 핫월렛당 초기 할당 | 100개 |
| 계정당 비용 | ~0.0015 SOL (환불 가능) |
| 확장 임계값 | 사용률 80% |
| 확장 단위 | 현재 풀의 20% |
| STUCK 감지 | 할당 후 5분 초과 미확정 |
| STUCK 해제 | nonce advance → 풀 반환 |

## 상태 전이 다이어그램

```
Nonce 계정 생명주기:

  CREATED → AVAILABLE → IN_USE → AVAILABLE (TX 확정 후 재사용)
                          ↓
                        STUCK → nonce advance → AVAILABLE
                          ↓
                       (장기 미해결)
                          ↓
                        수동 개입
```

## 참고 자료

- [Solana Durable Nonces](https://solana.com/docs/core/transactions/durable-nonces)
- [Transaction Confirmation & Expiration](https://solana.com/developers/guides/advanced/confirmation)
- [Retrying Transactions](https://solana.com/developers/guides/advanced/retry)

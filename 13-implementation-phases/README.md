# 13. 구현 페이즈

## 개요

Solana 통합을 4단계(12주)로 나누어 점진적으로 구현한다. 각 Phase는 독립적으로 테스트 가능한 deliverable을 가지며, Phase 종료 시 exit criteria를 충족해야 다음 Phase로 진행한다. 모든 Phase에서 기존 EVM 파이프라인에 대한 regression을 확인한다.

```
Phase 1: Foundation (Weeks 1-3)   → 기반 인프라 구축
Phase 2: Deposit (Weeks 4-6)      → 입금 파이프라인
Phase 3: Withdrawal (Weeks 7-10)  → 출금 파이프라인
Phase 4: Hardening (Weeks 11-12)  → 안정화 및 프로덕션 준비
```

---

## Phase 1: Foundation (Weeks 1-3)

### 목표

Solana 통합에 필요한 핵심 인프라를 구축한다. 이 Phase가 완료되면 KMS로 Ed25519 서명을 수행하고, RPC로 Solana 네트워크와 통신하며, DB에 Solana 데이터를 저장할 수 있는 상태가 된다.

### Week 1: KMS Ed25519 확장

| 작업 | 상세 | 의존성 |
|------|------|--------|
| KMS 키 생성 | `CreateKey(ECC_EDWARDS_ED25519)` 래퍼 구현 | AWS KMS 권한 |
| 공개키 추출 | `GetPublicKey` → DER 파싱 → raw 32 bytes | KMS 키 생성 |
| 주소 변환 | raw 32 bytes → base58 인코딩 → Solana 주소 | base58 유틸리티 |
| 서명 | `Sign(MessageType: RAW)` → 64 bytes 서명 | KMS 키 생성 |
| 검증 | `Verify` round-trip 테스트 | 서명 구현 |
| Golden Test | 고정 키 → 고정 주소 → 고정 서명 검증 | 모든 위 항목 |

**Deliverable:** KMS Ed25519 서명 PoC -- devnet에서 KMS 서명으로 SOL 전송 성공

### Week 2: Base58 유틸리티 + RPC 클라이언트

| 작업 | 상세 | 의존성 |
|------|------|--------|
| base58 인코딩/디코딩 | bs58 라이브러리 래핑 + 유효성 검증 | 없음 |
| 주소 검증 | base58 디코딩 → 32 bytes 확인 | base58 유틸리티 |
| RPC 클라이언트 래퍼 | 핵심 메서드 래핑 + 에러 처리 + 재시도 | RPC endpoint |
| `getSlot` | 최신 finalized slot 조회 | RPC 클라이언트 |
| `getBlocks` | slot 범위의 블록 목록 조회 | RPC 클라이언트 |
| `getBlock` | 특정 slot의 블록 데이터 조회 | RPC 클라이언트 |
| `sendTransaction` | TX 전송 + skipPreflight 옵션 | RPC 클라이언트 |
| `getSignatureStatuses` | TX 상태 조회 (배치) | RPC 클라이언트 |
| `getBalance` | SOL 잔액 조회 | RPC 클라이언트 |
| `getTokenAccountBalance` | SPL 토큰 잔액 조회 | RPC 클라이언트 |

RPC 클라이언트 설계 원칙:
```
- 모든 호출에 commitment 파라미터 명시 (기본값: finalized)
- 자동 재시도: 429 (rate limit), 503 (service unavailable) → 지수 백오프
- timeout: 기본 30초, getBlock은 60초
- 메트릭: 호출 횟수, 지연 시간, 에러율
- multi-provider: 기본 RPC + fallback RPC 설정
```

**Deliverable:** RPC 클라이언트 + 단위 테스트 (devnet 실제 응답 기반)

### Week 3: DB 마이그레이션

| 작업 | 상세 | 의존성 |
|------|------|--------|
| DDL 작성 | solana_blocks, solana_transactions, solana_transfers, solana_withdrawal_log, solana_nonce_accounts | ADR-3 참조 |
| 마이그레이션 스크립트 | Flyway/Liquibase 마이그레이션 파일 | DDL |
| 인덱스 설계 | 쿼리 패턴 기반 인덱스 | DDL |
| DAO 레이어 | 기본 CRUD + 입금/출금 전용 쿼리 | DDL |
| 중복 방지 테스트 | UNIQUE 제약 조건 + upsert 동작 검증 | DAO 레이어 |
| EVM regression | 기존 EVM 테이블/쿼리 무영향 확인 | 마이그레이션 |

**Deliverable:** DB 스키마 배포 완료, DAO 단위 테스트 통과

### Phase 1 Exit Criteria

- [ ] KMS Ed25519 키 생성 → 서명 → 검증 round-trip 성공
- [ ] devnet에서 KMS 서명으로 SOL 전송 성공
- [ ] RPC 클라이언트로 devnet의 finalized 블록 조회 성공
- [ ] solana_* 테이블 마이그레이션 완료 (dev/staging 환경)
- [ ] 기존 EVM 테스트 스위트 전체 통과 (regression 없음)
- [ ] base58 인코딩/디코딩 단위 테스트 통과

---

## Phase 2: Deposit Pipeline (Weeks 4-6)

### 목표

Solana 입금 파이프라인을 구축한다. finalized 슬롯을 스캔하여 SOL 및 SPL 토큰 입금을 감지하고, DB에 기록하며, 사용자 잔액에 반영한다.

### Week 4: Block Publisher Solana 플러그인

| 작업 | 상세 | 의존성 |
|------|------|--------|
| Slot Scanner | `getSlot(finalized)` → 마지막 처리 slot 이후 새 slot 탐지 | RPC 클라이언트 |
| `getBlocks` 범위 조회 | (lastProcessedSlot, latestFinalizedSlot) 범위의 slot 목록 | Slot Scanner |
| 빈 슬롯 처리 | `getBlock(slot)` → null 응답 시 스킵 + 로그 | getBlocks |
| 블록 데이터 수집 | `getBlock(slot, { transactionDetails: "full", rewards: false })` | Slot Scanner |
| Kafka 발행 | 블록 데이터를 Kafka 토픽에 발행 (S3 참조 방식) | Kafka 설정 |
| 진행 상태 저장 | 마지막 처리 slot을 DB/etcd에 저장 | DB |

Slot Scanner 흐름:
```
매 1초:
  latestFinalized = getSlot({ commitment: "finalized" })
  if latestFinalized > lastProcessed:
    slots = getBlocks(lastProcessed + 1, latestFinalized)
    for slot in slots:
      block = getBlock(slot)
      if block is null: continue  // 빈 슬롯
      publish(block)
      lastProcessed = slot
```

**Deliverable:** devnet에서 finalized 슬롯 실시간 스캔 + Kafka 발행

### Week 5: Block Consumer -- 전송 이벤트 추출

| 작업 | 상세 | 의존성 |
|------|------|--------|
| SOL 전송 감지 | preBalances/postBalances 비교 → SOL 이동 추출 | Block Publisher |
| SPL 토큰 전송 감지 | preTokenBalances/postTokenBalances 비교 → 토큰 이동 추출 | Block Publisher |
| 관심 주소 필터링 | 추출된 전송 중 우리 주소(입금 주소)와 관련된 것만 필터 | 주소 DB |
| 입금 방향 판별 | to_address가 우리 주소 → DEPOSIT | 필터링 |
| DB 저장 | solana_transfers 테이블에 저장 (idempotent upsert) | DAO 레이어 |

Balance diff 추출 로직:
```
SOL 전송 감지:
  for i in 0..accountKeys.length:
    diff = postBalances[i] - preBalances[i]
    if diff > 0 && accountKeys[i] in ourAddresses:
      → DEPOSIT: from=unknown, to=accountKeys[i], amount=diff

SPL 토큰 전송 감지:
  for each preTokenBalance:
    matching post = postTokenBalances with same accountIndex
    diff = post.amount - pre.amount
    if diff > 0 && owner in ourAddresses:
      → DEPOSIT: mint=pre.mint, to=owner, amount=diff

주의:
  - 수수료 차감도 balance diff에 포함되므로 fee payer 계정 주의
  - inner instructions에 의한 balance 변경도 반영됨
  - 한 TX에서 여러 전송이 있을 수 있음
```

### Week 6: 입금 E2E 통합 테스트

| 작업 | 상세 | 의존성 |
|------|------|--------|
| Event Confirmer 생략 | Block Consumer → Deposit Creditor 직결 (ADR-4) | ADR-4 |
| Deposit Creditor 연동 | confirmed 이벤트를 즉시 잔액에 반영 | Block Consumer |
| SOL 입금 E2E | devnet에서 SOL 전송 → 입금 감지 → 잔액 반영 확인 | 전체 파이프라인 |
| SPL 입금 E2E | devnet에서 SPL 전송 → 입금 감지 → 잔액 반영 확인 | 전체 파이프라인 + devnet 토큰 mint |
| 에지 케이스 | 빈 슬롯, 실패 TX, 0-amount 전송 등 | E2E 환경 |

**Deliverable:** devnet에서 SOL + SPL 토큰 입금 E2E 테스트 통과

### Phase 2 Exit Criteria

- [ ] devnet에서 SOL 입금 E2E 성공 (전송 → 감지 → DB 저장 → 잔액 반영)
- [ ] devnet에서 SPL 토큰 입금 E2E 성공
- [ ] Block Publisher lag < 5 slots (devnet 기준)
- [ ] 빈 슬롯 정상 스킵 확인
- [ ] idempotent 재처리 확인 (동일 블록 재처리 시 중복 입금 없음)
- [ ] 기존 EVM 테스트 스위트 전체 통과

---

## Phase 3: Withdrawal Pipeline (Weeks 7-10)

### 목표

Solana 출금 파이프라인을 구축한다. Durable nonce를 사용한 TX 구성, KMS 서명, 재전송 루프, 상태 모니터링을 구현한다.

### Week 7: Durable Nonce 풀 관리

| 작업 | 상세 | 의존성 |
|------|------|--------|
| Nonce 계정 생성 | SystemProgram.createNonceAccount 배치 실행 | KMS signer |
| 풀 상태 관리 | AVAILABLE/IN_USE/STUCK 상태 전이 | DB (solana_nonce_accounts) |
| 할당 로직 | 출금 요청 시 AVAILABLE → IN_USE 원자적 전환 | DB lock |
| 반환 로직 | TX 확정/취소 후 IN_USE → AVAILABLE 전환 | TX 모니터 |
| 동적 확장 | 사용률 80% 시 자동 생성 트리거 | 모니터링 |
| STUCK 해제 | 5분 초과 미확정 nonce → advance → 반환 | TX 모니터 |

**Deliverable:** devnet에서 nonce 풀 생성/할당/반환/확장 동작 확인

### Week 8: TX Preparer + TX Signer

| 작업 | 상세 | 의존성 |
|------|------|--------|
| TX Preparer | 출금 요청 → nonce 할당 → TX 구성 | Nonce 풀 |
| SOL 전송 TX | SystemProgram.transfer + nonceAdvance instruction | TX Preparer |
| SPL 전송 TX | TokenProgram.transfer + nonceAdvance + (ATA 생성) | TX Preparer |
| ATA 자동 생성 | 수신자 ATA 미존재 시 createAssociatedTokenAccountIdempotent 추가 | TX Preparer |
| TX Signer | KMS Ed25519 서명 적용 | KMS signer (Phase 1) |
| 서명 검증 | 서명 후 로컬에서 검증 (send 전 safety check) | TX Signer |

TX 구성 순서 (durable nonce):
```
Transaction:
  instruction[0]: SystemProgram.nonceAdvance(nonce_account, authority)  // 필수 첫 번째
  instruction[1]: SystemProgram.transfer(from, to, lamports)           // 실제 전송
  // 또는 SPL의 경우:
  instruction[1]: createAssociatedTokenAccountIdempotent(...)          // ATA 생성 (필요 시)
  instruction[2]: TokenProgram.transfer(from_ata, to_ata, amount)      // 토큰 전송

recentBlockhash: nonce_account.nonce_value  // recent blockhash 대신 nonce 값
feePayer: hot_wallet
```

**Deliverable:** devnet에서 durable nonce 기반 SOL/SPL 전송 TX 서명 성공

### Week 9: TX Sender + TX Monitor

| 작업 | 상세 | 의존성 |
|------|------|--------|
| TX Sender | `sendTransaction(skipPreflight: true)` + 2초 재전송 루프 | RPC 클라이언트 |
| signatureSubscribe | WebSocket으로 TX 상태 실시간 모니터링 | WebSocket 클라이언트 |
| 상태 추적 | BROADCASTED → CONFIRMED → FINALIZED 전이 | DB (solana_withdrawal_log) |
| STUCK 감지 | 30초 초과 미확정 TX 감지 | TX Monitor |
| Nonce Advance 취소 | STUCK TX → nonce advance → TX 재구성 | Nonce 풀 |
| 재전송 루프 | advance 후 새 nonce로 TX 재구성 → 재전송 | TX Preparer + TX Sender |

TX Sender 상태 머신:
```
CREATED → SIGNED → BROADCASTED → CONFIRMED → FINALIZED
                       ↓                        ↑
                   [30초 초과]              [재전송 성공]
                       ↓                        ↑
                   STUCK → NONCE_ADVANCED → REBUILT → BROADCASTED
                       ↓
                   [2분 초과]
                       ↓
                   ESCALATED → 수동 개입
```

**Deliverable:** devnet에서 TX 전송 → 재전송 루프 → 확정 E2E 성공

### Week 10: 출금 E2E 통합 테스트

| 작업 | 상세 | 의존성 |
|------|------|--------|
| SOL 출금 E2E | 출금 요청 → nonce 할당 → 서명 → 전송 → 확정 → 잔액 반영 | 전체 파이프라인 |
| SPL 출금 E2E | ATA 자동 생성 포함 SPL 토큰 출금 E2E | 전체 파이프라인 |
| 동시 출금 테스트 | 10건 동시 출금 → nonce 풀 정상 동작 확인 | 전체 파이프라인 |
| 실패 시나리오 | insufficient balance, ATA 미존재, RPC timeout 등 | 에러 처리 |
| 취소 시나리오 | 출금 취소 → nonce advance → TX 무효화 확인 | 취소 로직 |

**Deliverable:** devnet에서 SOL + SPL 토큰 출금 E2E 테스트 통과

### Phase 3 Exit Criteria

- [ ] devnet SOL 출금 E2E 성공
- [ ] devnet SPL 토큰 출금 E2E 성공 (ATA 자동 생성 포함)
- [ ] 10건 동시 출금 정상 처리
- [ ] STUCK TX 자동 감지 → nonce advance → 재전송 성공
- [ ] 출금 취소(nonce advance) 정상 동작
- [ ] 실패 TX 수수료 회계 정확성 확인
- [ ] nonce 풀 사용률 80% 도달 시 자동 확장 동작
- [ ] 기존 EVM 테스트 스위트 전체 통과

---

## Phase 4: Hardening (Weeks 11-12)

### 목표

Mainnet 환경에서의 안정성을 검증하고, 운영에 필요한 모니터링/알림/문서를 완성한다.

### Week 11: 부하 테스트 + 스트레스 테스트

| 작업 | 상세 | 의존성 |
|------|------|--------|
| Mainnet 데이터 볼륨 시뮬레이션 | mainnet RPC에서 실제 블록 데이터 크기/속도 측정 | mainnet RPC 접근 |
| Block Publisher 부하 테스트 | mainnet 수준 TPS에서 publisher lag 측정 | 볼륨 데이터 |
| Block Consumer 처리량 테스트 | 대량 TX 블록에서 balance diff 추출 성능 측정 | 볼륨 데이터 |
| Nonce 풀 스트레스 테스트 | 50건 동시 출금 → 풀 고갈/확장 시나리오 | devnet 환경 |
| TX 랜딩 테스트 | 혼잡 시뮬레이션에서 재전송 루프 안정성 | devnet 환경 |
| Kafka throughput 테스트 | Solana 블록 메시지 크기에서 Kafka 처리량 확인 | 볼륨 데이터 |

### Week 12: 모니터링 + 운영 준비

| 작업 | 상세 | 의존성 |
|------|------|--------|
| Grafana 대시보드 | publisher lag, TX landing rate, nonce utilization, confirmation time | 메트릭 수집 |
| 알림 규칙 | PagerDuty/Slack 알림 설정 (각 메트릭별 warn/critical) | 대시보드 |
| 운영 런북 | RPC 장애, nonce 고갈, STUCK TX, ATA 실패, fee payer 잔액 부족 | 모든 리스크 분석 |
| Synthetic 출금 Canary | 매 시간 소액 출금 → 정상 완료 확인 → 실패 시 알림 | 출금 파이프라인 |
| Production Readiness Review | 체크리스트 기반 최종 검토 | 모든 항목 |
| EVM Regression Final | EVM 전체 테스트 스위트 최종 실행 | 모든 변경 |

### Production Readiness Checklist

```
기능:
- [ ] SOL 입금/출금 E2E 통과
- [ ] SPL 토큰 입금/출금 E2E 통과
- [ ] 동시 출금 10건 이상 정상 처리
- [ ] STUCK TX 자동 복구 확인
- [ ] ATA 자동 생성/폐쇄 확인

성능:
- [ ] Block Publisher lag < 10 slots (mainnet 시뮬레이션)
- [ ] TX landing rate > 95% (재전송 포함)
- [ ] median confirmation time < 20초
- [ ] Kafka consumer lag < 100

운영:
- [ ] Grafana 대시보드 구축 완료
- [ ] 알림 규칙 설정 완료 (warn + critical)
- [ ] 운영 런북 작성 완료 (5개 시나리오 이상)
- [ ] Synthetic canary 동작 확인
- [ ] fee payer 지갑 잔액 충분 확인

안전:
- [ ] EVM regression test 전체 통과
- [ ] KMS 키 권한/정책 검토 완료
- [ ] RPC provider failover 테스트 완료
- [ ] nonce 풀 초기 할당 완료 (100개+)
- [ ] DB 백업/복구 절차 확인
```

### Phase 4 Exit Criteria

- [ ] Production Readiness Checklist 전 항목 통과
- [ ] Mainnet 데이터 볼륨에서 안정적 동작 확인
- [ ] 24시간 soak test 통과 (devnet)
- [ ] 운영팀 핸드오프 완료 (런북 + 대시보드 교육)

---

## 전체 타임라인 요약

```
Week 1-3   [Phase 1: Foundation]
           KMS Ed25519 | base58 | RPC Client | DB Migration
           ────────────────────────────────────────────────

Week 4-6   [Phase 2: Deposit]
           Block Publisher | Block Consumer | Deposit E2E
           ────────────────────────────────────────────────

Week 7-10  [Phase 3: Withdrawal]
           Nonce Pool | TX Prep/Sign | TX Send/Monitor | Withdrawal E2E
           ────────────────────────────────────────────────────────────

Week 11-12 [Phase 4: Hardening]
           Load Test | Monitoring | Runbook | Readiness Review
           ──────────────────────────────────────────────────
```

## 의존성 그래프

```
KMS Ed25519 ─────┐
                 ├─→ TX Signer ─→ TX Sender ─→ Withdrawal E2E
Nonce Pool ──────┤
                 ├─→ TX Preparer ┘
RPC Client ──────┤
                 ├─→ Block Publisher ─→ Block Consumer ─→ Deposit E2E
DB Migration ────┘
base58 utils ────┘
```

## 각 Phase별 롤백 계획

| Phase | 롤백 방법 | 영향 |
|-------|----------|------|
| Phase 1 | solana_* 테이블 DROP, KMS 키 비활성화 | EVM 무영향 |
| Phase 2 | Solana Block Publisher 중지, Kafka 토픽 삭제 | EVM 무영향 |
| Phase 3 | Solana 출금 비활성화, nonce 계정 유지(환불 가능) | EVM 무영향 |
| Phase 4 | 대시보드/알림 비활성화 | 모니터링만 영향 |

모든 Phase에서 기존 EVM 파이프라인은 독립적으로 동작하므로, Solana 관련 변경의 롤백이 EVM에 영향을 주지 않는다.

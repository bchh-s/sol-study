# 높은 리스크

상위 섹션: [11. 리스크 평가](../README.md)

---

## Risk 1: TX 랜딩 안정성

### 근본 원인

Solana에는 mempool이 없다. 트랜잭션은 현재 리더 노드에 직접 전달(forward)되며, 리더가 로테이션되는 시점에 도착한 TX는 **조용히 드롭**된다. EVM 체인에서는 mempool에 TX가 들어가면 어딘가에 보관되지만, Solana에서는 TX가 체인에 포함되지 않으면 그냥 사라진다.

구체적인 드롭 시나리오:

1. **리더 로테이션:** 현재 리더의 슬롯이 끝나는 시점에 도착한 TX는 다음 리더로 전달되지 않을 수 있음
2. **네트워크 혼잡:** 리더의 처리 큐가 가득 찬 경우 초과 TX를 드롭
3. **Priority Fee 경쟁:** compute unit price가 낮은 TX가 우선순위에서 밀림
4. **RPC 노드 장애:** RPC 노드가 리더에게 TX를 전달하지 못하는 경우

### 영향도: HIGH

- 출금 요청이 `BROADCASTED` 상태에서 멈춤
- 사용자 자금이 잠김 (hot wallet에서 빠져나갔지만 수신자에게 도달 안 됨 -- 단, durable nonce 사용 시 TX가 체인에 포함되지 않았으므로 자금은 여전히 hot wallet에 있음)
- 수동 개입 없이는 해결 불가 (자동 재시도 미구현 시)

### 발생 확률: HIGH

Solana mainnet에서 혼잡한 슬롯마다 발생하는 일상적 현상이다. 2024년 초 Solana 네트워크 혼잡 기간에는 TX 랜딩 실패율이 50%를 넘기도 했다. 정상 상태에서도 단일 전송으로 100% 랜딩을 보장할 수 없다.

### 완화 전략

#### 1단계: Durable Nonce 사용

```
recent blockhash 대신 durable nonce를 사용하면:
- blockhash 만료(60-90초)로 인한 TX 무효화 방지
- 동일한 TX를 blockhash 걱정 없이 반복 전송 가능
- TX가 드롭되어도 nonce가 advance되지 않았으므로 동일 TX 재전송 가능
```

#### 2단계: 2초 간격 재전송 루프

```
[TX 전송] → [2초 대기] → [signatureStatuses 확인]
                              ↓
                    confirmed/finalized? → 완료
                              ↓ (아직 없음)
                    [동일 TX 재전송] → [2초 대기] → ...
                              ↓ (30초 초과)
                    [STUCK 판정] → 에스컬레이션
```

재전송 루프의 핵심 파라미터:

| 파라미터 | 값 | 근거 |
|---------|-----|------|
| 재전송 간격 | 2초 | Solana 슬롯 시간(~400ms)의 5배, 네트워크 부하 고려 |
| 최대 재시도 | 15회 (30초) | finalized 확인까지 ~13초 + 여유 |
| Priority Fee | 동적 조정 | `getRecentPrioritizationFees`로 현재 수준 조회 |
| preflight 검사 | OFF | `skipPreflight: true` -- 프리플라이트는 RPC 노드 기준이라 리더 상태와 다를 수 있음 |

#### 3단계: signatureSubscribe WebSocket 모니터링

```
// WebSocket으로 TX 상태를 실시간 구독
ws.signatureSubscribe(signature, { commitment: 'finalized' })

// 콜백으로 확정 즉시 감지
onNotification: (result) => {
  if (result.err === null) → TX_CONFIRMED
  else → TX_FAILED (체인에 포함됐으나 실행 실패)
}
```

### 탐지 방법

| 조건 | 판정 | 대응 |
|------|------|------|
| `BROADCASTED` 상태 30초 초과 | STUCK | 자동 재전송 루프 재시작 |
| `BROADCASTED` 상태 2분 초과 | CRITICAL_STUCK | nonce advance + TX 재구성 |
| `signatureStatuses` 응답 없음 5분 초과 | TX_LOST | nonce advance → 새 TX 생성 |
| `signatureStatuses`에서 `err` 반환 | TX_FAILED | 실패 원인 분석 → 재시도 또는 알림 |

### 복구 플레이북

```
1. STUCK TX 감지 (BROADCASTED > 30초)
   ↓
2. getSignatureStatuses(signature) 호출
   ↓
3-a. 상태 존재 + confirmations > 0 → 대기 (곧 finalized)
3-b. 상태 없음 → TX가 체인에 포함되지 않음
   ↓
4. Nonce Advance 실행 (SystemProgram.nonceAdvance)
   - 이전 TX가 혹시 나중에 처리되는 것을 방지
   ↓
5. 새 TX 구성 (새로운 nonce 값 사용)
   ↓
6. 2초 간격 재전송 루프 재시작
   ↓
7. 2회 사이클(총 4분) 후에도 실패 → 수동 에스컬레이션
```

### 모니터링 메트릭

| 메트릭 | 수집 방법 | 정상 범위 | 알림 기준 |
|--------|----------|----------|----------|
| `tx_landing_rate` | 성공 TX / 전체 TX 시도 | > 95% | < 95% warn, < 80% critical |
| `avg_retry_count` | TX당 재전송 횟수 평균 | 1-3회 | > 5 warn, > 10 critical |
| `median_confirmation_time` | 전송 ~ finalized 중앙값 | 5-15초 | > 30초 warn, > 60초 critical |
| `stuck_tx_count` | 현재 STUCK 상태 TX 수 | 0 | > 0 warn, > 5 critical |
| `nonce_advance_count` | nonce advance 발생 횟수/시간 | 0-2/hr | > 5/hr warn, > 10/hr critical |

### EVM과의 비교

| 항목 | EVM | Solana |
|------|-----|--------|
| TX 제출 후 보관 | mempool에 보관 | 보관 없음 (리더에 직접 전달) |
| TX 드롭 | gas price too low로 evict | 조용히 드롭 (알림 없음) |
| 재시도 전략 | nonce 동일 + gas price 증가 | 동일 TX 재전송 (durable nonce) |
| 취소 전략 | 동일 nonce + 높은 gas 빈 TX | nonce advance |
| 상태 확인 | `eth_getTransactionReceipt` | `getSignatureStatuses` |

---

## Risk 2: Durable Nonce 풀 고갈

### 근본 원인

각 동시 출금 트랜잭션은 자신만의 고유한 durable nonce 계정을 사용해야 한다. Nonce 계정은 한 번에 하나의 TX에만 할당될 수 있으며, TX가 확정되거나 취소(nonce advance)될 때까지 다른 TX에 재사용할 수 없다.

```
[출금 요청 A] → nonce_account_1 할당 → TX 전송 → 확정 → nonce_account_1 반환
[출금 요청 B] → nonce_account_2 할당 → TX 전송 → 확정 → nonce_account_2 반환
[출금 요청 C] → nonce_account_3 할당 → ... (동시 처리)

만약 nonce 계정이 2개뿐이라면:
[출금 요청 C] → 대기 (nonce 없음) → 블록!
```

### 영향도: HIGH

- 풀 고갈 시 새로운 출금 요청을 처리할 수 없음
- 사용자 출금 지연 → 고객 불만 및 자금 이동 제한
- STUCK TX가 nonce를 점유하면 연쇄적 고갈 가속

### 발생 확률: MEDIUM

정상 운영 시 충분한 사전 할당으로 방지 가능하지만, 대량 출금 이벤트(시장 폭락, 거래소 이벤트)나 STUCK TX 누적 시 발생 가능.

### 풀 규모 산정

```
필요 nonce 수 = 피크 동시 출금 수 x 안전 계수(2x)

예시:
- 평균 동시 출금: 10건
- 피크 동시 출금: 30건 (시장 급변 시)
- 안전 계수: 2x
- 권장 풀 크기: 60개 (최소), 100개 (권장)

비용:
- nonce 계정 생성 비용: ~0.0015 SOL (rent-exempt 최소 잔액)
- 100개 계정: 0.15 SOL (~$30 at $200/SOL)
- 비용은 계정 폐쇄 시 전액 환불 가능
```

### 완화 전략

#### 사전 할당

```
핫월렛 생성 시:
1. authority 키 생성 (KMS)
2. nonce 계정 100개 사전 생성
3. 각 nonce 계정의 authority = 핫월렛 authority
4. DB에 nonce pool 상태 기록

nonce_accounts 테이블:
| nonce_pubkey | authority | status   | assigned_tx | created_at |
|-------------|-----------|----------|-------------|------------|
| NonceAcc1   | HotWlt1   | AVAILABLE| NULL        | 2026-05-21 |
| NonceAcc2   | HotWlt1   | IN_USE   | tx_id_123   | 2026-05-21 |
| NonceAcc3   | HotWlt1   | AVAILABLE| NULL        | 2026-05-21 |
```

#### 동적 확장 (80% 임계값)

```
[매 10초 모니터링]
  ↓
사용률 = IN_USE / 전체 nonce 수
  ↓
사용률 < 80% → 정상
사용률 >= 80% → WARN 알림 + 자동 확장 트리거
사용률 >= 95% → CRITICAL 알림 + 긴급 확장
  ↓
자동 확장: 현재 풀의 20% 추가 생성
  - 100개 풀 → 20개 추가 → 120개
  - 각 생성에 ~30초 소요 (TX 전송 + finalized 대기)
  - 20개 생성 시 ~10분 (병렬 처리 시 ~2분)
```

#### STUCK TX 해제로 nonce 회수

```
[매 30초 스캔]
  ↓
IN_USE 상태 nonce 중 할당 시간 > 5분 경과 확인
  ↓
해당 TX의 signature status 확인
  ↓
TX 미확정 + 5분 초과 → nonce advance 실행
  ↓
nonce advance 확정 → nonce 상태를 AVAILABLE로 변경
  ↓
원래 출금 요청: 새 nonce 할당 → TX 재구성 → 재전송
```

### 탐지 및 알림

| 조건 | 등급 | 대응 |
|------|------|------|
| 풀 사용률 > 80% | WARN | Slack 알림, 자동 확장 시작 |
| 풀 사용률 > 95% | CRITICAL | PagerDuty, 긴급 확장 + 출금 큐 일시 중단 고려 |
| 사용 가능 nonce = 0 | EMERGENCY | 출금 처리 완전 중단, 수동 개입 필요 |
| STUCK nonce > 10개 | WARN | STUCK TX 일괄 해제 실행 |

### 비용 분석

| 항목 | 수량 | 단가 | 합계 | 비고 |
|------|------|------|------|------|
| 초기 nonce 계정 | 100개 | 0.0015 SOL | 0.15 SOL | 환불 가능 |
| 동적 확장 여유분 | 50개 | 0.0015 SOL | 0.075 SOL | 환불 가능 |
| nonce advance TX 수수료 | ~10회/일 | 5,000 lamports | 0.00005 SOL/일 | 환불 불가 |
| **총 초기 비용** | | | **~0.225 SOL** | **대부분 환불 가능** |

---

## Risk 3: 블록 데이터 볼륨

### 근본 원인

Solana는 초당 50,000+ TPS를 처리하며, 이는 EVM 체인(~30 TPS)보다 1,000배 이상 많다. 각 블록(슬롯)에 포함된 트랜잭션 수와 데이터 크기가 EVM 대비 압도적으로 크다.

```
EVM 블록:
- 블록 생성 주기: ~12초
- TX 수: ~150-200개/블록
- 블록 크기: ~100KB
- 시간당 데이터: ~30MB

Solana 슬롯:
- 슬롯 생성 주기: ~400ms
- TX 수: ~2,000-5,000개/슬롯 (피크 시 수만)
- 슬롯 크기: ~1-10MB (full block data)
- 시간당 데이터: ~9-90GB (full), ~500MB-2GB (필터링 후)
```

### 영향도: MEDIUM

- Block Publisher 지연 → 입금 감지 지연
- Kafka 메시지 크기 초과 가능
- Consumer 처리 백프레셔 → 전체 파이프라인 지연
- RPC 노드 응답 시간 증가 → timeout 빈발
- 대역폭 및 스토리지 비용 증가

### 발생 확률: HIGH (mainnet에서 상시)

Devnet에서는 트래픽이 적어 문제가 드러나지 않지만, mainnet 전환 시 반드시 발생한다.

### 완화 전략

#### 1. gRPC/Geyser 스트리밍 사용

```
기존 RPC 폴링:
  getBlocks(start, end) → getBlock(slot) → 전체 블록 JSON 파싱
  문제: 블록 전체를 받아야 하므로 불필요한 데이터 과다

Geyser/gRPC 스트리밍:
  subscribe(filter: { accounts: [our_addresses], programs: [TOKEN_PROGRAM] })
  → 관심 있는 계정/프로그램의 변경만 실시간 수신
  → 대역폭 90%+ 절감
```

Geyser를 사용할 수 없는 경우(RPC 제공자 제한 등) 대비 RPC 폴링 최적화도 필요:

#### 2. 선택적 필드 가져오기

```
// getBlock 호출 시 최소 필드만 요청
{
  "encoding": "jsonParsed",
  "transactionDetails": "full",
  "rewards": false,              // 보상 데이터 제외
  "maxSupportedTransactionVersion": 0
}

// 또는 getSignaturesForAddress로 관심 주소만 필터링
getSignaturesForAddress(depositAddress, { limit: 100 })
→ 해당 주소와 관련된 TX만 조회
→ 전체 블록 파싱 불필요
```

#### 3. 병렬 블록 처리

```
단일 스레드 처리:
  slot 100 → slot 101 → slot 102 → ... (순차)
  처리 속도: ~200ms/slot → 초당 5슬롯
  Solana 슬롯 생성: 초당 2.5슬롯
  → 여유 있지만 피크 시 밀릴 수 있음

병렬 처리 (worker pool):
  Worker 1: slot 100, 104, 108, ...
  Worker 2: slot 101, 105, 109, ...
  Worker 3: slot 102, 106, 110, ...
  Worker 4: slot 103, 107, 111, ...
  → 처리 속도 4배 향상
  → Kafka 파티션도 slot % N으로 분배

주의: 빈 슬롯(리더가 블록 생산 실패) 처리 필요
  getBlock(slot) → null 응답 시 스킵
```

#### 4. Kafka 메시지 크기 관리

```
EVM 블록 메시지: ~50-200KB
Solana 슬롯 메시지: ~1-10MB (전체 블록 시)

대응:
- Kafka max.message.bytes 조정 (기본 1MB → 10MB)
- 또는 블록 데이터를 S3에 저장 + Kafka에는 참조만 전송 (현재 EVM 패턴)
- Solana에서는 S3 저장이 더 중요: 블록당 데이터가 크므로 Kafka를 참조 채널로만 사용
```

### 탐지 방법

| 메트릭 | 설명 | 정상 | 경고 | 위험 |
|--------|------|------|------|------|
| `publisher_lag_slots` | 최신 finalized slot - 마지막 처리 slot | 0-5 | > 10 | > 50 |
| `block_processing_time_ms` | 슬롯 1개 처리 소요 시간 | < 200ms | > 500ms | > 1000ms |
| `kafka_consumer_lag` | Consumer가 처리하지 못한 메시지 수 | 0-10 | > 100 | > 1000 |
| `rpc_response_time_ms` | getBlock RPC 응답 시간 | < 500ms | > 2000ms | > 5000ms |
| `bandwidth_mbps` | RPC 데이터 수신 대역폭 | < 10 | > 50 | > 100 |

### 용량 계획

```
Mainnet 추정 (보수적):

RPC 폴링 방식:
- 슬롯당 평균 데이터: ~3MB
- 초당 슬롯: 2.5
- 시간당 원시 데이터: ~27GB
- 일일 원시 데이터: ~650GB
- 필터링 후 (관심 주소만): 원시의 ~1-5% → ~13-32GB/일

gRPC/Geyser 방식:
- 관심 계정 변경만 수신
- 시간당 데이터: ~100-500MB (주소 수에 비례)
- 일일 데이터: ~2.4-12GB

필요 인프라:
- RPC 노드: 전용 노드 또는 Helius/Triton 등 고성능 제공자
- 네트워크: 최소 100Mbps 대역폭
- 저장소: S3에 일일 ~10-30GB (필터링 후)
- Compute: block-publisher 2-4 vCPU, block-consumer 2-4 vCPU
```

### EVM과의 비교

| 항목 | EVM | Solana |
|------|-----|--------|
| 블록 생성 주기 | ~12초 | ~400ms |
| 블록당 TX 수 | 150-200 | 2,000-5,000+ |
| 시간당 데이터 | ~30MB | ~27GB (raw) |
| 입금 감지 | event log 기반 | balance diff 기반 |
| 실시간 스트리밍 | WebSocket newHeads | gRPC/Geyser |
| 빈 블록 처리 | 없음 (항상 블록 존재) | 빈 슬롯 스킵 필요 |

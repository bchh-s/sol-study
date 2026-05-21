# 5.4 EVM과의 핵심 차이

상위 섹션: [5. Q3: TX 전송 및 재전송 방식](../README.md)

## 운영 관점 핵심 차이 테이블

| # | 항목 | EVM | Solana | 영향도 |
|---|------|-----|--------|--------|
| 1 | TX 교체 (replacement) | 같은 nonce + 더 높은 gas로 교체 가능 | **불가능**. 새 TX 서명 필요 | 높음 |
| 2 | Mempool | 있음. TX가 안전하게 대기 | **없음**. 리더가 안 받으면 드롭 | 매우 높음 |
| 3 | 재전송 전략 | gas bump 시에만 재전송 | **2초마다 적극적 재전송** 필수 | 매우 높음 |
| 4 | TX 취소 방법 | 같은 nonce로 self-transfer (0 ETH) | **durable nonce advance** | 높음 |
| 5 | 동시 출금 처리 | nonce 순서대로 자동 직렬화 | nonce 계정 풀 크기 = **동시 처리 상한** | 높음 |
| 6 | stuck TX 판단 | receipt 미확인 + 시간 경과 | signatureStatus null + **storedNonce 동일** | 중간 |
| 7 | 실패 TX 비용 | 전체 gas 소비 | **base fee만 소비** (~0.000005 SOL) | 낮음 |
| 8 | TX ID 결정 시점 | signed TX의 keccak256 (전송 전 알 수 있음) | **signature = TX ID** (서명 시점에 결정) | 낮음 |
| 9 | 확인 수준 | 블록 confirmations 카운트 | **processed / confirmed / finalized** 3단계 | 중간 |
| 10 | Fee 구조 | gasPrice x gasUsed | base fee (고정) + **priority fee** (선택) | 중간 |

## 각 차이 상세 분석

### 1. TX 교체 불가능 (No Replacement TX)

EVM에서는 같은 nonce를 가진 새 TX를 더 높은 gas price로 전송하면, mempool에서 기존 TX를 교체(replace)할 수 있다. 이것이 "gas bump"의 원리이다.

```
EVM gas bump:
  TX_v1: nonce=42, gasPrice=20 gwei, to=0xBob, value=1 ETH
  TX_v2: nonce=42, gasPrice=22 gwei, to=0xBob, value=1 ETH  ← 교체
  → mempool에서 TX_v1이 TX_v2로 교체됨
  → 블록에는 TX_v2만 포함됨 (하나만 실행)
```

Solana에서는 이것이 **완전히 불가능**하다:

```
Solana:
  TX_A: storedNonce=X, signature=SIG_A, instructions=[AdvanceNonce, Transfer]
  TX_B: storedNonce=X, signature=SIG_B, instructions=[AdvanceNonce, Transfer(higher fee)]
  
  → TX_A와 TX_B는 같은 storedNonce(X)를 사용하므로 둘 중 하나만 성공 가능
  → 그러나 어느 것이 먼저 처리될지 보장 없음
  → TX_A를 확실히 취소하려면 먼저 nonce advance 필요
```

**Dagaon Core 영향**: priority fee를 올려야 할 때, 기존 TX를 교체하는 것이 아니라:
1. 기존 TX를 nonce advance로 무효화
2. 새 nonce 값으로 TX를 다시 빌드
3. KMS로 다시 서명
4. 전송

이 과정이 EVM보다 한 단계(nonce advance) 더 필요하고, KMS 서명도 다시 받아야 한다.

### 2. Mempool 부재 (Silent Drops)

EVM에서 `eth_sendRawTransaction`이 성공하면, TX는 mempool에 들어가고 **언젠가 블록에 포함된다** (gas price가 충분하다면). 노드가 살아있는 한 TX가 유실될 걱정이 없다.

Solana에서 `sendTransaction`이 성공하면, 이는 **RPC 노드가 TX를 받았다는 의미일 뿐**이다:

```
sendTransaction 성공 후 가능한 시나리오:

시나리오 A: RPC → 현재 리더 → 블록에 포함 (성공)
시나리오 B: RPC → 현재 리더 → 리더가 바쁨 → 드롭 (유실)
시나리오 C: RPC → 리더 교체 중 → 전달 실패 → 드롭 (유실)
시나리오 D: RPC → TPU 포트 → 패킷 손실 → 드롭 (유실)
```

**드롭 시 어떤 에러도 반환되지 않는다.** `sendTransaction`은 이미 성공 응답을 보냈고, 이후의 드롭은 아무도 알려주지 않는다.

```
EVM:
  sendRawTransaction() 성공 = TX가 mempool에 있음 (확실)
  
Solana:
  sendTransaction() 성공 = RPC가 받았음 (블록 포함 여부는 불확실)
```

**Dagaon Core 영향**: tx-sender가 단순히 "전송 후 대기"하는 것이 아니라, **적극적으로 재전송하는 루프**를 돌려야 한다.

### 3. 적극적 재전송 (Aggressive Retry)

EVM에서는 재전송이 gas bump가 필요할 때만 발생한다. 일반적으로 TX를 한 번 보내면 된다.

Solana에서는 **모든 TX에 대해** 확인될 때까지 2초 간격으로 재전송해야 한다:

```
Solana 공식 권장 재전송 전략:

1. sendTransaction(signedTx, { maxRetries: 0 })
2. signatureSubscribe(signature) 등록

loop:
  3. sleep(2초)
  4. sendTransaction(signedTx, { skipPreflight: true, maxRetries: 0 })
  5. getSignatureStatuses([signature])
  6. if confirmed → break
  7. if retry_count > MAX → escalate (priority fee bump or abort)
  goto loop
```

왜 `maxRetries: 0`인가? Solana RPC 노드에도 자체 재전송 로직이 있지만:
- RPC의 재전송 주기와 횟수를 우리가 제어할 수 없다
- 재전송 상태를 추적할 수 없다
- 우리 코드에서 직접 재전송해야 정확한 모니터링이 가능하다

왜 `skipPreflight: true`인가? 재전송 시에는:
- 이미 첫 전송에서 preflight 시뮬레이션을 통과함
- preflight 시뮬레이션은 추가 RPC 부하를 발생시킴
- 재전송에서는 스킵하여 속도 향상

### 4. TX 취소 방법

```
EVM 취소:
  1. 취소하고 싶은 TX의 nonce를 확인 (예: nonce=42)
  2. 같은 nonce(42)로 self-transfer(0 ETH) TX를 더 높은 gas로 전송
  3. self-transfer가 원본 TX를 mempool에서 교체
  4. self-transfer가 블록에 포함되면 원본은 영원히 무효
  비용: gas 소비 (self-transfer의 21000 gas)

Solana 취소:
  1. 취소하고 싶은 TX가 사용한 nonce 계정 확인
  2. AdvanceNonceAccount instruction만 포함한 TX 전송
  3. storedNonce가 변경되면 기존 서명된 TX는 자동 무효화
  비용: ~0.000005 SOL (TX 수수료만)
```

**차이점 요약**:

| 항목 | EVM | Solana |
|------|-----|--------|
| 취소 TX 내용 | self-transfer (0 ETH) | AdvanceNonce (단독) |
| 원리 | 같은 nonce의 새 TX가 교체 | storedNonce 변경으로 기존 TX 무효화 |
| 확실성 | mempool에서 교체 경쟁 (불확실) | nonce advance 성공 시 확실 |
| 비용 | 21000 gas x gasPrice | ~0.000005 SOL |

Solana의 취소가 더 **결정적(deterministic)** 이다. EVM에서는 원본 TX가 취소 TX보다 먼저 블록에 포함될 수 있지만, Solana에서는 nonce advance가 성공하면 기존 TX는 확실히 무효화된다.

### 5. 동시 출금 처리

```
EVM:
  nonce = 순차 정수 (0, 1, 2, 3, ...)
  TX들은 nonce 순서대로 처리되어야 함
  nonce=2가 pending이면 nonce=3은 블록에 포함될 수 없음
  → 하나가 stuck되면 뒤의 모든 TX가 대기

  동시 처리? 여러 TX를 mempool에 넣을 수 있지만,
  블록 포함은 순서대로만 가능 (head-of-line blocking)

Solana:
  각 출금마다 별도의 nonce 계정 사용
  nonce_account_1: 출금 #42
  nonce_account_2: 출금 #43
  nonce_account_3: 출금 #44
  
  → 각 출금이 독립적으로 처리됨
  → 하나가 stuck되어도 다른 출금에 영향 없음
  → 동시 처리 상한 = nonce 계정 풀 크기
```

**Dagaon Core 영향**: nonce 계정 풀의 크기가 곧 동시 출금 처리 능력이다. 충분한 수의 nonce 계정을 사전에 준비해야 한다.

### 6. Priority Fee Bump: 새 TX 서명 필요

EVM에서 gas bump는 같은 nonce로 새 TX를 보내면 되지만, Solana에서 priority fee를 올리려면:

```
EVM gas bump:
  원본 TX: nonce=42, gasPrice=20
  bump TX: nonce=42, gasPrice=22  ← 같은 nonce, 서명만 다시
  → 1회 KMS 서명

Solana priority fee bump:
  1. 원본 TX를 nonce advance로 무효화
  2. 새 storedNonce 조회
  3. 새 TX 빌드 (더 높은 priority fee)
  4. KMS 서명 (새 메시지이므로 새 서명 필요)
  5. 전송 + 재전송 루프
  → 2회 KMS 서명 (advance TX + 새 출금 TX)
  → 또는 advance TX에는 recentBlockhash 사용 시 1회 추가
```

### 7. 실패 TX도 비용 발생

```
EVM:
  TX 실행 실패 (revert) → 전체 gas 소비
  예: gasLimit=200000, gasPrice=20 gwei
     → 실패해도 200000 * 20 gwei = 0.004 ETH 소비

Solana:
  TX 실행 실패 → base fee만 소비 (~0.000005 SOL)
  compute unit은 소비되지 않음
  priority fee도 소비되지 않음 (TX가 실패하면)
  
  → 실패 비용이 EVM 대비 극히 저렴
  → 공격적인 재전송이 경제적으로 부담 없음
```

## Dagaon Core 마이그레이션 체크리스트

위 차이점들을 기반으로 한 코드 변경 체크리스트:

| # | 변경 항목 | 영향 컴포넌트 | 상태 |
|---|----------|-------------|------|
| 1 | gas bump 로직을 nonce advance + 새 TX로 교체 | tx-monitor | 미완 |
| 2 | 2초 간격 재전송 루프 구현 | tx-sender | 미완 |
| 3 | signatureSubscribe WebSocket 연결 관리 | tx-sender, tx-monitor | 미완 |
| 4 | getSignatureStatuses 폴링 구현 | tx-monitor | 미완 |
| 5 | nonce 계정 풀 관리 모듈 신규 개발 | nonce-pool-manager (신규) | 미완 |
| 6 | self-transfer 취소를 nonce advance 취소로 교체 | tx-monitor | 미완 |
| 7 | TX status 상태 전이 확장 (CONFIRMED, FINALIZED 추가) | DB 스키마 | 미완 |
| 8 | storedNonce 기반 TX 유효성 판단 로직 | tx-monitor | 미완 |
| 9 | maxRetries=0 + skipPreflight 파라미터 관리 | tx-sender | 미완 |
| 10 | priority fee 조회 및 동적 조정 | tx-preparer | 미완 |

## 참고 자료

- Solana Transaction Fees: https://solana.com/docs/core/fees
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces

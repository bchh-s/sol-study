# 6.4 Fee 구조 상세

상위 섹션: [6. Q4: Fee Delegation](../README.md)

## Solana Fee 구조 개요

Solana의 트랜잭션 수수료는 두 가지 요소로 구성된다:

```
총 수수료 = Base Fee + Priority Fee (선택)

Base Fee:     고정, 서명 수에 비례
Priority Fee: 가변, Compute Unit 사용량에 비례
```

---

## 1. Base Fee (기본 수수료)

### 계산 공식

```
base_fee = 5,000 lamports * 서명 수
```

- **서명 1개당 5,000 lamports** (0.000005 SOL)
- 현재 SOL 가격 $170 기준 약 $0.00085/서명
- 대부분의 트랜잭션은 서명 1~2개

### 분배 구조

```
5,000 lamports (서명당)
    ├── 50% → 소각 (burn)          = 2,500 lamports
    └── 50% → 블록 생산 validator  = 2,500 lamports
```

50% 소각은 SOL의 디플레이션 메커니즘으로 작동한다.
네트워크 사용량이 증가할수록 SOL 공급이 줄어든다.

### 일반적인 Base Fee 예시

| 트랜잭션 유형 | 서명 수 | Base Fee |
|-------------|---------|----------|
| SOL 전송 | 1 | 5,000 lamports (0.000005 SOL) |
| SPL Token 전송 (fee payer = owner) | 1 | 5,000 lamports |
| SPL Token 전송 (fee payer != owner) | 2 | 10,000 lamports |
| ATA 생성 + Token 전송 | 1~2 | 5,000~10,000 lamports |

---

## 2. Priority Fee (우선순위 수수료)

### 계산 공식

```
priority_fee = ceil(compute_unit_price * compute_unit_limit / 1,000,000) lamports
```

- `compute_unit_price`: micro-lamports 단위 (1 micro-lamport = 0.000001 lamport)
- `compute_unit_limit`: 이 트랜잭션에서 사용할 최대 Compute Unit
- 1,000,000으로 나누는 이유: micro-lamports → lamports 변환

### 계산 예시

```
예시 1: 일반적인 SPL Token 전송
  compute_unit_price  = 1,000 micro-lamports/CU
  compute_unit_limit  = 200,000 CU
  priority_fee = ceil(1,000 * 200,000 / 1,000,000) = 200 lamports
  → 약 $0.000034

예시 2: 혼잡한 프로그램 접근
  compute_unit_price  = 100,000 micro-lamports/CU
  compute_unit_limit  = 200,000 CU
  priority_fee = ceil(100,000 * 200,000 / 1,000,000) = 20,000 lamports
  → 약 $0.0034

예시 3: DEX 아비트라지 (극단적)
  compute_unit_price  = 10,000,000 micro-lamports/CU
  compute_unit_limit  = 400,000 CU
  priority_fee = ceil(10,000,000 * 400,000 / 1,000,000) = 4,000,000 lamports
  → 약 $0.68
```

### Priority Fee 설정 방법

`ComputeBudgetProgram`의 instruction을 트랜잭션에 추가한다:

```typescript
import {
  ComputeBudgetProgram,
  Transaction,
} from '@solana/web3.js';

const tx = new Transaction();

// 1. Compute Unit Price 설정 (priority fee 결정)
tx.add(
  ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1_000  // micro-lamports per CU
  })
);

// 2. Compute Unit Limit 설정 (선택, 기본값 200,000)
tx.add(
  ComputeBudgetProgram.setComputeUnitLimit({
    units: 100_000  // 실제 사용량보다 약간 높게
  })
);

// 3. 실제 instruction 추가
tx.add(
  createTransferInstruction(sourceATA, destATA, owner, amount)
);
```

**중요:** `setComputeUnitPrice`와 `setComputeUnitLimit`은 반드시 트랜잭션의 **첫 번째 instruction들**로 추가해야 한다. 이들은 `ComputeBudgetProgram`(11111111111111111111111111111112)의 instruction이다.

---

## 3. Compute Unit (CU) 상세

### 기본값과 최대값

| 항목 | 값 |
|------|---|
| instruction당 기본 CU 한도 | 200,000 CU |
| 트랜잭션당 최대 CU 한도 | 1,400,000 CU |
| 빌트인 instruction CU 비용 | 150 CU (ed25519 서명 검증 등 기본 작업) |
| `SetComputeUnitLimit` 범위 | 1 ~ 1,400,000 CU |

### 일반적인 CU 소비량

| 작업 | 대략적 CU 소비 |
|------|--------------|
| System Program: transfer | ~150 CU |
| SPL Token: transfer | ~3,000~5,000 CU |
| SPL Token: transferChecked | ~4,000~6,000 CU |
| ATA 생성 | ~20,000~25,000 CU |
| ComputeBudget instruction 자체 | ~150 CU |

### CU Limit 최적화 전략

```typescript
// 방법 1: simulateTransaction으로 실제 CU 소비량 측정
const simulation = await connection.simulateTransaction(tx);
const actualCU = simulation.value.unitsConsumed;
// 실제 소비량의 1.2배~1.5배를 limit으로 설정
const safeLimit = Math.ceil(actualCU * 1.3);

// 방법 2: 보수적 기본값 사용
// SPL Token transfer: 100,000 CU (넉넉하게)
// ATA 생성 + transfer: 200,000 CU
```

**CU Limit을 낮게 설정하는 이점:**
- Priority fee가 `price * limit`이므로, limit을 줄이면 fee가 줄어든다
- 예: price=1,000, limit=200,000 → fee=200 lamports
- 예: price=1,000, limit=50,000  → fee=50 lamports (75% 절약)

---

## 4. 로컬 Fee 시장 (Local Fee Markets)

### EVM과의 핵심 차이

```
EVM (글로벌 fee 시장):
  - 모든 TX가 같은 mempool에서 경쟁
  - NFT 민팅이 폭주하면 → 단순 ETH 전송 가스비도 급등
  - 모든 사용자가 영향을 받음

Solana (로컬 fee 시장):
  - 프로그램별(write-lock 기준) 독립적 fee 경쟁
  - Jupiter DEX가 폭주해도 → SPL Token transfer는 영향 없음
  - 같은 계정(write-lock)을 경쟁하는 TX만 fee가 올라감
```

### 동작 원리

Solana의 스케줄러는 **write-lock이 겹치는 트랜잭션**끼리만 경쟁시킨다:

```
Slot 내 트랜잭션 스케줄링:

Thread 1: [TX-A: write(Account1)] [TX-D: write(Account1)]  ← 같은 계정 = 경쟁
Thread 2: [TX-B: write(Account2)] [TX-E: write(Account2)]  ← 같은 계정 = 경쟁
Thread 3: [TX-C: write(Account3)]                          ← 독립 = 경쟁 없음

→ Account1에 대한 TX-A와 TX-D만 서로 priority fee 경쟁
→ Account3에 접근하는 TX-C는 priority fee 0이어도 빠르게 처리됨
```

### Dagaon Core에서의 의미

커스터디얼 서비스의 SPL Token transfer는 대부분 **고유한 deposit 지갑 ATA**에 write-lock을 건다.
인기 DEX나 NFT 마켓플레이스의 혼잡과 무관하게 일정한 fee를 유지할 수 있다.

단, 같은 핫월렛 계정에서 동시에 여러 TX를 보내면 핫월렛 계정에 write-lock이 집중될 수 있다.
→ **핫월렛 분산** 또는 **durable nonce 활용**으로 대응 가능

---

## 5. getRecentPrioritizationFees RPC

### 사용법

```typescript
// 특정 프로그램/계정에 대한 최근 priority fee 조회
const fees = await connection.getRecentPrioritizationFees({
  lockedWritableAccounts: [
    new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')  // Token Program
  ]
});

// 응답 형태
// [
//   { slot: 283201034, prioritizationFee: 0 },
//   { slot: 283201035, prioritizationFee: 1000 },
//   { slot: 283201036, prioritizationFee: 500 },
//   ...최근 150 슬롯
// ]
```

### 응답 해석

```typescript
interface PrioritizationFee {
  slot: number;               // 슬롯 번호
  prioritizationFee: number;  // 해당 슬롯에서의 최소 priority fee (lamports)
}
```

- 최근 150개 슬롯의 데이터를 반환
- 각 슬롯에서 해당 계정에 접근한 TX 중 **최소** priority fee를 보여줌
- fee가 0인 슬롯은 경쟁이 없었다는 의미

---

## 6. 프로덕션 Fee 추정 전략

### 기본 전략: 백분위 기반

```typescript
async function estimatePriorityFee(
  connection: Connection,
  writableAccounts: PublicKey[],
  targetPercentile: number = 75  // 75th percentile
): Promise<number> {
  const fees = await connection.getRecentPrioritizationFees({
    lockedWritableAccounts: writableAccounts,
  });

  // fee가 0인 항목 제거 (경쟁 없는 슬롯)
  const nonZeroFees = fees
    .map(f => f.prioritizationFee)
    .filter(f => f > 0)
    .sort((a, b) => a - b);

  if (nonZeroFees.length === 0) {
    return 0;  // 경쟁 없음, priority fee 불필요
  }

  // 목표 백분위 계산
  const index = Math.ceil(nonZeroFees.length * targetPercentile / 100) - 1;
  return nonZeroFees[Math.min(index, nonZeroFees.length - 1)];
}
```

### 실무 권장 설정

```typescript
async function buildOptimizedTransaction(
  connection: Connection,
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  writableAccounts: PublicKey[]
): Promise<Transaction> {
  const tx = new Transaction();
  tx.feePayer = feePayer;

  // 1. Priority fee 추정
  const estimatedFee = await estimatePriorityFee(
    connection,
    writableAccounts
  );

  // 2. 최소값과 최대값 설정 (비용 폭주 방지)
  const MIN_PRIORITY_FEE = 1_000;      // 1,000 micro-lamports
  const MAX_PRIORITY_FEE = 1_000_000;  // 1,000,000 micro-lamports
  const priorityFee = Math.max(
    MIN_PRIORITY_FEE,
    Math.min(estimatedFee, MAX_PRIORITY_FEE)
  );

  // 3. CU price 설정
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFee,
    })
  );

  // 4. CU limit 설정 (시뮬레이션 기반)
  // 먼저 instruction을 추가한 후 시뮬레이션
  for (const ix of instructions) {
    tx.add(ix);
  }

  // 5. 시뮬레이션으로 실제 CU 측정
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const simulation = await connection.simulateTransaction(tx);

  if (simulation.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }

  const cuLimit = Math.ceil((simulation.value.unitsConsumed || 200_000) * 1.3);

  // 6. CU limit instruction을 앞에 삽입
  // (Transaction의 instructions 배열 첫 번째에)
  const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: Math.min(cuLimit, 1_400_000),
  });

  // instructions 배열 재구성: [cuPrice, cuLimit, ...원래 instructions]
  const finalTx = new Transaction();
  finalTx.feePayer = feePayer;
  finalTx.add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
  );
  finalTx.add(cuLimitIx);
  for (const ix of instructions) {
    finalTx.add(ix);
  }

  return finalTx;
}
```

### 비용 요약

```
Dagaon Core SPL Token transfer 기준:

Base Fee:     5,000 lamports (서명 1개)          = 0.000005 SOL
Priority Fee: 1,000 * 50,000 / 1,000,000        = 50 lamports (보수적)
ATA 생성:     ~2,040,000 lamports (rent, 1회성)  = 0.00204 SOL

일반 transfer 총 비용: ~5,050 lamports ≈ $0.0009
ATA 생성 포함 시:      ~2,045,050 lamports ≈ $0.35 (rent는 refundable)

→ EVM L1 대비 100~1,000배 저렴
→ EVM L2 대비 2~10배 저렴
```

## 참고 링크

- [Solana Fees Documentation](https://solana.com/docs/core/fees)
- [Compute Budget Program](https://solana.com/docs/core/fees#compute-budget)
- [Priority Fees Guide](https://solana.com/developers/guides/advanced/how-to-use-priority-fees)
- [getRecentPrioritizationFees RPC](https://solana.com/docs/rpc/http/getrecentprioritizationfees)

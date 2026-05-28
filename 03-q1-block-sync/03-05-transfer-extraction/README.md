# 3.5 Transfer 추출 방식 비교

상위 섹션: [3. Q1: Block Sync 아키텍처 호환성](../README.md)

## 핵심 차이

EVM에서는 **Event Log를 파싱**하여 transfer를 감지한다.
Solana에서는 **잔액 변화(balance diff)를 비교**하여 transfer를 감지한다.

```
EVM:    receipt.logs → topic[0] == Transfer 시그니처? → from/to/amount 디코딩
Solana: meta.preBalances vs meta.postBalances 비교 → diff > 0이면 수신
        meta.preTokenBalances vs meta.postTokenBalances 비교 → diff > 0이면 토큰 수신
```

## 왜 trace 없이 모든 SOL 이동을 알 수 있는가

balance diff 방식이 성립하는 **근본 이유**다. EVM과 비교하면 명확해진다.

### EVM: internal transaction은 trace가 필요

EVM에서는 컨트랙트가 실행 도중 내부적으로 ETH를 또 전송할 수 있다(internal transaction). 이 내부 전송은 `receipt`에 찍히지 않으므로, 익스플로러/인덱서는 `debug_traceTransaction`(또는 `trace_call`) 같은 **별도의 무거운 trace RPC**를 돌려야 숨은 이동을 잡는다.

### Solana: 계정 사전 선언 모델 → 숨은 이동이 원천적으로 없음

Solana의 핵심 규칙:

```
잔액이 바뀌는 계정은 반드시 트랜잭션의 accountKeys에 미리 선언되어 있어야 한다.
(선언되지 않은 계정은 런타임이 접근을 막음 — 병렬 실행 Sealevel의 전제)
```

→ 런타임은 그 선언된 **모든 계정**의 실행 전/후 잔액을 `preBalances`/`postBalances`로 기록한다.
→ 따라서 **"숨은 SOL 이동"이 존재할 수 없고**, 전/후 스냅샷의 diff만으로 그 TX의 SOL 흐름이 100% 재구성된다. **trace 불필요.**

| | EVM | Solana |
|---|---|---|
| 네이티브 코인 추적 | internal tx는 **trace 필요** | **trace 불필요** (pre/postBalances가 완전) |
| 왜? | 컨트랙트가 임의 계정에 송금 가능 | 건드릴 계정을 **전부 사전 선언** 강제 |
| 내부 호출 내역 | `debug_traceTransaction` 별도 호출 | `meta.innerInstructions`로 **같은 응답에 포함** |
| 배열 길이 | - | 1232바이트 제한 → 최대 ~256 계정 (→ [7.4](../../07-solana-basics/07-04-transaction-structure/README.md)) |

### innerInstructions는 별도 RPC가 아니다

EVM의 trace와 달리, Solana는 `getBlock()`/`getTransaction()` **한 번의 응답 안에** `meta.innerInstructions`(CPI로 내부 호출된 instruction)를 같이 준다. 추적용으로 따로 RPC를 칠 필요가 없다.

```jsonc
// getTransaction / getBlock 응답
"meta": {
  "preBalances":  [...],   "postBalances":  [...],
  "preTokenBalances": [...], "postTokenBalances": [...],
  "innerInstructions": [ { "index": 0, "instructions": [ /* CPI */ ] } ]
}
```

### 단, diff는 "순변화(net)"만 알려준다

balance diff는 각 계정의 **최종 순변화**만 보여준다. 한 TX 안에서 A→B→C로 흘렀다면:

```
A: -5 SOL    B: 0 SOL (받았다 그대로 전달)    C: +5 SOL
```

회계상 정산(누가 얼마 잃고 얻었나)은 완벽하지만, **중간 경로(hop)** 는 diff만으로 안 보일 수 있다. 경로까지 필요하면 `innerInstructions`를 파싱한다 (아래 `inner_instruction_index` 참고).

## CRITICAL: 실패 TX 필터링 (meta.err)

**이 섹션에서 가장 중요한 내용이다.**

EVM에서 실패한 TX는 `receipt.status = 0`이며, 해당 TX의 event log에는 Transfer가 없다.
따라서 log를 파싱하면 자연스럽게 실패 TX가 필터링된다.

Solana에서 실패한 TX는 **블록에 포함**되며, `preBalances`/`postBalances`에 변화가 나타난다 (base fee 차감).

```
DANGER: 실패 TX를 필터링하지 않으면?

실패한 TX의 preBalances/postBalances:
  pre:  [1,000,000,000  ,  500,000,000]
  post: [  999,995,000  ,  500,000,000]
  diff: [     -5,000     ,           0]
  
  → fee payer에서 5,000 lamports만 차감됨 (base fee)
  → 실제 transfer는 발생하지 않았음!
  
  만약 meta.err 체크 없이 모든 TX의 balance diff를 추출하면:
  → fee 차감을 transfer로 잘못 인식할 수 있음
  → 또는 "미완성 상태 변경"을 transfer로 인식
```

### 올바른 처리 순서

```
1. meta.err !== null 확인 → 실패 TX면 즉시 건너뜀
2. preBalances vs postBalances diff 계산 → Native SOL transfer
3. preTokenBalances vs postTokenBalances diff 계산 → SPL token transfer
```

```typescript
// 실패 TX 필터링 (필수!)
for (const tx of block.transactions) {
  // =====================================================
  // CRITICAL: meta.err가 null이 아니면 실패 TX → 건너뜀
  // =====================================================
  if (tx.meta?.err !== null) {
    // 실패 사유 예시:
    // { "InstructionError": [0, { "Custom": 1 }] }
    // { "InsufficientFundsForFee": null }
    continue;
  }
  
  // 여기부터 성공 TX만 처리
  extractNativeTransfers(tx);
  extractSplTokenTransfers(tx);
}
```

## EVM Transfer 추출 (현재 Dagaon Core)

### Native ETH 전송

```go
// 방법 1: tx.value > 0
if tx.Value.Cmp(big.NewInt(0)) > 0 {
    transfers = append(transfers, Transfer{
        Type:   NATIVE,
        From:   tx.From,
        To:     tx.To,
        Amount: tx.Value,
    })
}

// 방법 2: Internal transactions (trace_call)
for _, trace := range tx.Traces {
    if trace.Value.Cmp(big.NewInt(0)) > 0 {
        transfers = append(transfers, Transfer{
            Type:         NATIVE,
            From:         trace.From,
            To:           trace.To,
            Amount:       trace.Value,
            TraceAddress: trace.TraceAddress,
        })
    }
}
```

### ERC20 Token 전송

```go
// Transfer(address from, address to, uint256 value)
// topic[0] = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef

const TRANSFER_TOPIC = "0xddf252ad..."

for _, log := range receipt.Logs {
    if log.Topics[0] == TRANSFER_TOPIC && len(log.Topics) == 3 {
        from := common.BytesToAddress(log.Topics[1].Bytes())
        to := common.BytesToAddress(log.Topics[2].Bytes())
        amount := new(big.Int).SetBytes(log.Data)
        
        transfers = append(transfers, Transfer{
            Type:     ERC20,
            Contract: log.Address,
            From:     from,
            To:       to,
            Amount:   amount,
            LogIndex: log.LogIndex,
        })
    }
}
```

### EVM Transfer 고유 식별자

```
(chain_id, block_hash, tx_hash, transfer_type, log_index, trace_address)

예시:
  Native: (1, 0xabc..., 0x123..., NATIVE, -1, "0")
  ERC20:  (1, 0xabc..., 0x123..., ERC20,  3,  "")
  ERC721: (1, 0xabc..., 0x123..., ERC721, 5,  "")
```

## Solana Transfer 추출 (변경)

### Native SOL 전송: preBalances/postBalances Diff

`getBlock()` 응답의 각 TX에는 `preBalances`와 `postBalances` 배열이 포함된다.
배열의 인덱스는 `accountKeys`의 인덱스와 대응한다.

```
TX 구조:
  accountKeys: [
    "9WzDXwBb...",   // index 0: fee payer (sender)
    "7Np41oey...",   // index 1: receiver
    "11111111...",   // index 2: System Program
  ]
  
  preBalances:  [1,000,000,000,  500,000,000,  1]
  postBalances: [  999,990,000,  500,005,000,  1]
                ─────────────  ─────────────
                -10,000         +5,000
                (5,000 transfer + 5,000 fee)   (5,000 SOL 수신)
```

### SOL Transfer 추출 로직

```typescript
interface NativeTransfer {
  from: string;
  to: string;
  amount: number;   // lamports
  txSignature: string;
}

function extractNativeTransfers(tx: TransactionResponse): NativeTransfer[] {
  const transfers: NativeTransfer[] = [];
  const meta = tx.meta!;
  const accounts = tx.transaction.message.accountKeys;
  const fee = meta.fee;
  
  // 각 계정의 잔액 변화 계산
  for (let i = 0; i < accounts.length; i++) {
    const diff = meta.postBalances[i] - meta.preBalances[i];
    
    // 수신 계정 감지: diff > 0
    if (diff > 0) {
      // sender 찾기: 동일 금액만큼 잔액이 감소한 계정
      // (fee payer는 diff = -(transfer_amount + fee) 이므로 주의)
      
      transfers.push({
        from: findSender(tx, diff),  // 잔액이 감소한 계정
        to: accounts[i].toBase58(),
        amount: diff,
        txSignature: tx.transaction.signatures[0],
      });
    }
  }
  
  return transfers;
}
```

### Fee Payer와 Transfer 금액 구분

```
중요: fee payer(보통 index 0)의 잔액 변화에서 fee를 분리해야 함

예시:
  accounts[0] (fee payer + sender):
    pre:  1,000,000,000
    post:   999,990,000
    diff:     -10,000
    fee:        5,000
    → 실제 전송 금액: |diff| - fee = 10,000 - 5,000 = 5,000 lamports

  accounts[1] (receiver):
    pre:    500,000,000
    post:   500,005,000
    diff:       +5,000
    → 수신 금액: 5,000 lamports (이것이 정확한 transfer 금액)

결론: 수신 측(diff > 0)의 금액을 transfer 금액으로 사용하는 것이 더 안전
```

### SPL Token 전송: preTokenBalances/postTokenBalances Diff

```
TX 구조 (SPL Token Transfer 포함):
  preTokenBalances: [
    {
      "accountIndex": 3,
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  // USDC
      "owner": "9WzDXwBb...",  // sender의 wallet
      "uiTokenAmount": {
        "amount": "1000000000",    // 1,000 USDC (6 decimals)
        "decimals": 6,
        "uiAmount": 1000.0
      }
    },
    {
      "accountIndex": 4,
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  // USDC
      "owner": "7Np41oey...",  // receiver의 wallet
      "uiTokenAmount": {
        "amount": "500000000",     // 500 USDC
        "decimals": 6,
        "uiAmount": 500.0
      }
    }
  ]
  
  postTokenBalances: [
    {
      "accountIndex": 3,
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "owner": "9WzDXwBb...",
      "uiTokenAmount": {
        "amount": "900000000",     // 900 USDC (-100 USDC)
        "decimals": 6,
        "uiAmount": 900.0
      }
    },
    {
      "accountIndex": 4,
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "owner": "7Np41oey...",
      "uiTokenAmount": {
        "amount": "600000000",     // 600 USDC (+100 USDC)
        "decimals": 6,
        "uiAmount": 600.0
      }
    }
  ]
  
  → USDC 100개가 9WzDXwBb... → 7Np41oey... 로 전송됨
```

### SPL Token Transfer 추출 로직

```typescript
interface SplTokenTransfer {
  mint: string;           // 토큰 민트 주소 (ERC20 contract address 대응)
  from: string;           // owner 주소 (wallet address)
  to: string;             // owner 주소 (wallet address)
  amount: bigint;         // raw amount (decimals 적용 전)
  decimals: number;
  txSignature: string;
}

function extractSplTokenTransfers(tx: TransactionResponse): SplTokenTransfer[] {
  const transfers: SplTokenTransfer[] = [];
  const meta = tx.meta!;
  const pre = meta.preTokenBalances ?? [];
  const post = meta.postTokenBalances ?? [];
  
  // postTokenBalances를 기준으로 변화 감지
  for (const postEntry of post) {
    // 동일 accountIndex의 pre 값 찾기
    const preEntry = pre.find(p => p.accountIndex === postEntry.accountIndex);
    
    const preAmount = preEntry ? BigInt(preEntry.uiTokenAmount.amount) : 0n;
    const postAmount = BigInt(postEntry.uiTokenAmount.amount);
    const diff = postAmount - preAmount;
    
    if (diff > 0n) {
      // 토큰 수신 감지
      // sender 찾기: 같은 mint에서 잔액이 감소한 다른 accountIndex
      const sender = findTokenSender(pre, post, postEntry.mint, postEntry.accountIndex);
      
      transfers.push({
        mint: postEntry.mint,
        from: sender?.owner ?? "unknown",
        to: postEntry.owner ?? "unknown",
        amount: diff,
        decimals: postEntry.uiTokenAmount.decimals,
        txSignature: tx.transaction.signatures[0],
      });
    }
  }
  
  // Edge case: preTokenBalances에만 있고 postTokenBalances에 없는 경우
  // → 토큰 계정이 close됨 (전액 전송 후 계정 close)
  for (const preEntry of pre) {
    const postEntry = post.find(p => p.accountIndex === preEntry.accountIndex);
    if (!postEntry && BigInt(preEntry.uiTokenAmount.amount) > 0n) {
      // 이 계정의 전체 잔액이 다른 곳으로 전송됨
      // postTokenBalances에서 같은 mint의 잔액 증가 계정을 receiver로 판단
    }
  }
  
  return transfers;
}
```

## Transfer 고유 식별자 변경

### EVM

```
Transfer Unique Key:
  (chain_id, block_hash, tx_hash, transfer_type, log_index, trace_address)

예시:
  Native ETH:   (1, "0xabc...", "0x123...", 1, -1, "0.1")
  ERC20:        (1, "0xabc...", "0x123...", 2, 5,  "")
  ERC721:       (1, "0xabc...", "0x123...", 3, 7,  "")
```

### Solana

```
Transfer Unique Key:
  (chain_id, slot_number, tx_signature, instruction_index, inner_instruction_index)

예시:
  Native SOL:   (900, 289567890, "5UfDuX7...", 0, -1)
  SPL Token:    (900, 289567890, "5UfDuX7...", 1, 0)
  SPL NFT:      (900, 289567890, "5UfDuX7...", 2, 1)
```

### 왜 instruction_index를 사용하는가?

Solana TX는 **여러 instruction을 하나의 TX에 번들링**할 수 있다 (EVM의 multicall과 유사).
하나의 TX에서 여러 transfer가 발생할 수 있으므로, instruction_index로 구분해야 한다.

```
TX 예시: 3개의 SOL transfer를 하나의 TX로 번들
  Instruction[0]: System.Transfer(A → B, 1 SOL)
  Instruction[1]: System.Transfer(A → C, 2 SOL)
  Instruction[2]: System.Transfer(A → D, 0.5 SOL)

  → 3개의 별도 transfer 레코드 생성
  → instruction_index로 구분: (sig, 0, -1), (sig, 1, -1), (sig, 2, -1)
```

### inner_instruction_index

CPI(Cross-Program Invocation)로 인해 하나의 instruction 내에서 추가 transfer가 발생할 수 있다.

```
TX:
  Instruction[0]: DEX Program.Swap(...)
    ├── Inner[0]: Token Program.Transfer(user_tokenA → pool_tokenA, 100)
    └── Inner[1]: Token Program.Transfer(pool_tokenB → user_tokenB, 200)

  → Transfer Key: (sig, 0, 0) = user가 tokenA 100개 보냄
  → Transfer Key: (sig, 0, 1) = user가 tokenB 200개 받음
```

## 실제 getBlock() 응답에서의 Transfer 추출 예시

```json
{
  "transactions": [
    {
      "transaction": {
        "signatures": [
          "3Td5YzRZ1pe38wUpqiVTCHBiuU7Nvi7NiQejHCmE5UMCBs2wy2bJJJZzrLU5PBrPvYkEfkiNLbUapfcLhGSJx3o"
        ],
        "message": {
          "accountKeys": [
            {"pubkey": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "signer": true, "writable": true},
            {"pubkey": "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2", "signer": false, "writable": true},
            {"pubkey": "11111111111111111111111111111111", "signer": false, "writable": false}
          ],
          "instructions": [
            {
              "programId": "11111111111111111111111111111111",
              "parsed": {
                "type": "transfer",
                "info": {
                  "source": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
                  "destination": "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2",
                  "lamports": 1000000000
                }
              }
            }
          ]
        }
      },
      "meta": {
        "err": null,
        "fee": 5000,
        "preBalances": [5000000000, 0, 1],
        "postBalances": [3999995000, 1000000000, 1],
        "preTokenBalances": [],
        "postTokenBalances": [],
        "innerInstructions": [],
        "logMessages": [
          "Program 11111111111111111111111111111111 invoke [1]",
          "Program 11111111111111111111111111111111 success"
        ]
      }
    }
  ]
}
```

### 추출 과정

```
Step 1: meta.err === null → 성공 TX, 계속 진행

Step 2: Native SOL Transfer 추출
  accountKeys[0] = "9WzDXwBb..." (signer, fee payer)
    pre:  5,000,000,000
    post: 3,999,995,000
    diff: -1,000,005,000 (= -1 SOL transfer - 5,000 fee)
    
  accountKeys[1] = "7Np41oey..." (receiver)
    pre:  0
    post: 1,000,000,000
    diff: +1,000,000,000 (= +1 SOL)
    
  accountKeys[2] = "11111111..." (System Program)
    pre:  1
    post: 1
    diff: 0 (변화 없음)

  → Transfer 감지:
    from: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
    to:   "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2"
    amount: 1,000,000,000 lamports (= 1 SOL)

Step 3: SPL Token Transfer 추출
  preTokenBalances: []
  postTokenBalances: []
  → SPL token transfer 없음

Step 4: 검증 (parsed instruction과 대조)
  instruction.parsed.info.lamports = 1,000,000,000
  → balance diff와 일치 확인!
```

## balance diff vs instruction 파싱: 어떤 방법을 쓸 것인가?

| 방법 | 장점 | 단점 |
|------|------|------|
| **Balance diff** (권장) | CPI 등 모든 전송을 포착, 단순함 | 여러 transfer가 있을 때 from/to 매핑이 모호할 수 있음 |
| **Instruction 파싱** | from/to가 명확 | CPI inner instruction까지 파싱해야 완전, encoding이 "jsonParsed"여야 함 |
| **하이브리드** (최적) | 정확도 + 완전성 | 구현 복잡도 증가 |

### Dagaon Core 권장 접근

```
1단계: balance diff로 "무엇이 변했는지" 감지
2단계: instruction 파싱으로 "왜 변했는지" 확인 (from/to 명확화)
3단계: 두 결과를 교차 검증

실무적으로는: 
  - 커스터디얼 지갑이므로 감시 지갑(to)에 대한 잔액 증가만 추적하면 됨
  - postBalances/postTokenBalances에서 감시 지갑의 잔액 증가 감지
  - from 추적이 필수가 아니라면 balance diff만으로 충분
```

## Edge Cases

### 1. Self-transfer (자기 자신에게 전송)

```
preBalances:  [1,000,000,000]
postBalances: [  999,995,000]
diff: -5,000 (fee만 차감)

→ self-transfer는 balance diff에서 0으로 나타남 (fee 제외)
→ 실제 전송 금액은 0이므로 transfer로 기록할 필요 없음
```

### 2. 계정 생성과 동시에 transfer

```
새 계정에 SOL을 보내면 계정이 자동 생성됨
preBalances:  [1,000,000,000, 0]        ← 0은 "계정 없음"
postBalances: [  999,000,000, 890000]   ← rent-exempt 최소 잔액

diff for receiver: +890,000 lamports
→ transfer 금액에 rent deposit이 포함될 수 있음
```

### 3. 하나의 TX에 여러 transfer

```
Instruction[0]: Transfer A→B 1 SOL
Instruction[1]: Transfer A→C 2 SOL

balance diff:
  A: pre=10 SOL, post=6.99999 SOL, diff=-3.00001 (3 SOL + fee)
  B: pre=0 SOL, post=1 SOL, diff=+1 SOL
  C: pre=0 SOL, post=2 SOL, diff=+2 SOL

→ receiver 기준으로 2개의 transfer 레코드 생성
```

### 4. Token 계정 close 후 잔액 회수

```
preTokenBalances:  [{accountIndex:3, amount:"100", owner:"UserA"}]
postTokenBalances: []  ← 계정이 close됨

→ close 시 남은 토큰이 다른 계정으로 전송됨
→ postTokenBalances에서 같은 mint의 잔액 증가를 찾아야 함
```

## Dagaon Core DB 저장 구조

```sql
-- Solana transfer 레코드 예시
INSERT INTO solana_transfers 
  (chain_id, slot_number, tx_signature, instruction_index, 
   inner_instruction_index, transfer_type, mint_address,
   from_address, to_address, amount, status)
VALUES
  (900, 289567890, '5UfDuX7WXY4J3...', 0, -1, 
   1, NULL,  -- transfer_type=1(native), mint=NULL
   '9WzDXwBb...', '7Np41oey...', '1000000000', 1);
```

## 참고 자료

- [Solana RPC - getBlock (TX 구조)](https://solana.com/docs/rpc/http/getblock)
- [SPL Token Program](https://spl.solana.com/token)
- [Add Solana to Your Exchange](https://solana.com/developers/guides/advanced/exchange)

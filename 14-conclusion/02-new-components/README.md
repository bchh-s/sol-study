# 새로 구현해야 하는 것

상위 섹션: [14. 결론](../README.md)

---

## 개요

Solana의 아키텍처가 EVM과 근본적으로 다른 영역에서는 새로운 컴포넌트를 구현해야 한다. 아래 각 항목에 대해 복잡도, 의존성, 리스크 수준을 분석한다.

---

## 1. 슬롯 기반 블록 스캐닝

### 무엇이 다른가

EVM에서는 블록 번호가 순차적이고 모든 번호에 블록이 존재한다. Solana에서는 슬롯 번호가 순차적이지만 **빈 슬롯(skipped slot)**이 존재한다 -- 리더가 블록 생산에 실패하면 해당 슬롯은 비게 된다.

```
EVM:
  block 100 → block 101 → block 102 → block 103  (모든 번호에 블록 존재)
  getBlockByNumber(101) → 항상 블록 반환

Solana:
  slot 100 → (빈) → slot 102 → (빈) → slot 104  (빈 슬롯 존재)
  getBlock(101) → null (빈 슬롯)
  getBlocks(100, 104) → [100, 102, 104] (존재하는 슬롯만 반환)
```

### 구현 내용

```
SolanaBlockPublisher:

1. 최신 finalized slot 조회:
   latestSlot = getSlot({ commitment: "finalized" })

2. 존재하는 슬롯 목록 가져오기:
   slots = getBlocks(lastProcessed + 1, latestSlot, { commitment: "finalized" })
   → 빈 슬롯은 자동으로 제외됨

3. 각 슬롯의 블록 데이터 가져오기:
   for slot in slots:
     block = getBlock(slot, {
       encoding: "jsonParsed",
       transactionDetails: "full",
       rewards: false,
       maxSupportedTransactionVersion: 0
     })
     if block is null: continue  // 방어적 null 체크
     publish(block)
     updateLastProcessed(slot)

4. 빈 슬롯 갭 처리:
   - getBlocks가 빈 슬롯을 이미 제외하므로 별도 처리 불필요
   - 단, previousBlockhash 검증 시 빈 슬롯 갭을 고려해야 함
     (slot 104의 parentSlot이 102일 수 있음, 103은 빈 슬롯)
```

| 항목 | 값 |
|------|-----|
| 복잡도 | 중간 |
| 의존성 | RPC 클라이언트, Kafka, etcd (진행 상태) |
| 리스크 | 중간 (mainnet 볼륨에서 성능 검증 필요) |
| 추정 기간 | 1주 |

---

## 2. Balance Diff 기반 전송 추출

### 무엇이 다른가

EVM에서는 `Transfer(from, to, amount)` 이벤트 로그가 명시적으로 발행되어 파싱하면 된다. Solana에서는 이벤트 로그가 없으므로, 트랜잭션 실행 전후의 **잔액 차이(balance diff)**를 비교하여 전송을 추출한다.

```
EVM:
  Transaction Receipt → logs[] → Transfer(from, to, value) 이벤트
  → 명시적이고 구조화된 데이터

Solana:
  Transaction → meta.preBalances / meta.postBalances (SOL)
             → meta.preTokenBalances / meta.postTokenBalances (SPL)
  → 잔액 차이 계산으로 전송 추출
```

### 구현 내용

```
SOL 전송 추출:
  accountKeys = tx.transaction.message.accountKeys
  preBalances = tx.meta.preBalances
  postBalances = tx.meta.postBalances

  for i in 0..accountKeys.length:
    diff = postBalances[i] - preBalances[i]
    if diff > 0:
      // 이 계정으로 SOL이 들어옴
      transfers.push({
        type: 'SOL',
        to: accountKeys[i],
        amount: diff  // lamports
      })
    elif diff < 0:
      // 이 계정에서 SOL이 나감 (수수료 포함일 수 있음)
      // fee payer의 diff는 전송금액 + 수수료이므로 분리 필요
      fee = tx.meta.fee
      if i === 0:  // fee payer는 보통 첫 번째 계정
        actualSent = abs(diff) - fee
      else:
        actualSent = abs(diff)

SPL 토큰 전송 추출:
  pre = tx.meta.preTokenBalances  // [{accountIndex, mint, owner, amount}, ...]
  post = tx.meta.postTokenBalances

  for each postEntry:
    matching preEntry = pre.find(p => p.accountIndex === postEntry.accountIndex)
    preAmount = matchingPreEntry?.uiTokenAmount.amount ?? "0"
    postAmount = postEntry.uiTokenAmount.amount
    diff = BigInt(postAmount) - BigInt(preAmount)

    if diff > 0:
      transfers.push({
        type: 'SPL',
        mint: postEntry.mint,
        to: postEntry.owner,
        amount: diff,
        decimals: postEntry.uiTokenAmount.decimals
      })
```

### 주의사항

- **수수료 분리:** fee payer의 SOL balance diff에는 전송금액 + 수수료가 합쳐져 있음
- **실패한 TX:** `meta.err !== null`인 경우에도 수수료는 차감됨. 전송은 발생하지 않음
- **다중 전송:** 한 TX에서 여러 계정 간 전송이 가능 (Solana 명령어 배칭)
- **Token 2022:** 새로운 토큰 프로그램(Token Extensions)도 동일한 balance diff 방식으로 감지 가능

| 항목 | 값 |
|------|-----|
| 복잡도 | 높음 |
| 의존성 | Block Publisher, 주소 DB, 토큰 설정 DB |
| 리스크 | 중간 (에지 케이스 다수, 충분한 테스트 필요) |
| 추정 기간 | 1.5주 |

---

## 3. Durable Nonce 풀 관리

### 무엇이 다른가

EVM에서는 계정의 nonce가 자동으로 증가하며 별도 관리가 불필요하다. Solana에서는 durable nonce가 별도의 온체인 계정으로 존재하며, 이 계정들의 풀을 직접 관리해야 한다.

```
EVM:
  nonce = getTransactionCount(address)  // 자동 증가
  TX에 nonce 포함 → 전송 → nonce 자동 +1
  → 관리할 것 없음

Solana:
  1. nonce 계정 생성 (SystemProgram.createNonceAccount)
  2. nonce 값 조회 (getNonce 또는 getAccountInfo)
  3. TX에 nonce 값 + nonceAdvance instruction 포함
  4. TX 확정 시 nonce 자동 advance
  5. TX 취소 시 수동 nonce advance 필요
  → 풀 관리 필요 (생성, 할당, 반환, 확장, STUCK 해제)
```

### 구현 내용

```
NoncePoolManager:

  createPool(authority, count):
    - count개의 nonce 계정 생성
    - 각각 SystemProgram.createNonceAccount TX 전송
    - DB에 AVAILABLE 상태로 등록

  allocate(withdrawalId):
    - AVAILABLE 상태인 nonce 1개를 원자적으로 IN_USE로 변경
    - 할당된 nonce의 현재 값 조회 (getAccountInfo → NonceAccount.fromAccountData)
    - { nonceAccount, nonceValue } 반환

  release(nonceAccount):
    - IN_USE → AVAILABLE 상태 변경
    - TX 확정 후 호출

  advanceAndRelease(nonceAccount):
    - STUCK nonce → nonceAdvance TX 전송 → AVAILABLE 상태 변경
    - STUCK TX 해제 시 호출

  expand(additionalCount):
    - 추가 nonce 계정 생성
    - 사용률 80% 도달 시 자동 트리거

  monitor():
    - 매 10초 사용률 체크
    - 매 30초 STUCK nonce 스캔 (IN_USE > 5분)
    - 메트릭 발행: pool_size, in_use, available, stuck
```

| 항목 | 값 |
|------|-----|
| 복잡도 | 높음 |
| 의존성 | KMS signer, RPC 클라이언트, DB |
| 리스크 | 높음 (동시성 관리, STUCK 해제 안정성) |
| 추정 기간 | 1.5주 |

---

## 4. Mempool 없는 환경의 적극적 TX 재전송

### 무엇이 다른가

EVM에서는 mempool에 TX가 들어가면 결국 마이닝된다(gas price가 충분하다면). Solana에서는 mempool이 없으므로 TX가 리더에게 전달되지 않으면 조용히 드롭된다.

```
EVM:
  sendTransaction → mempool 진입 → (대기) → 마이닝
  재전송: 필요 시 gas price 증가 (동일 nonce)
  모니터링: eth_getTransactionReceipt 폴링

Solana:
  sendTransaction → 리더에게 직접 전달 → 드롭 가능
  재전송: 동일 TX를 2초마다 반복 전송 (durable nonce 덕분에 가능)
  모니터링: signatureSubscribe(WebSocket) + getSignatureStatuses(폴링)
```

### 구현 내용

```
SolanaTxSender:

  send(signedTx):
    signature = sendTransaction(signedTx, { skipPreflight: true })
    startRetryLoop(signature, signedTx)

  retryLoop(signature, signedTx):
    retryCount = 0
    while retryCount < MAX_RETRIES (15):
      sleep(2000)  // 2초 대기

      status = getSignatureStatuses([signature])
      if status.confirmationStatus === 'finalized':
        return SUCCESS
      if status.confirmationStatus === 'confirmed':
        continue  // finalized 대기

      if status is null:
        // TX가 아직 체인에 포함되지 않음 → 재전송
        sendTransaction(signedTx, { skipPreflight: true })
        retryCount++

    // MAX_RETRIES 초과
    return STUCK → 에스컬레이션

  // WebSocket 병행 모니터링
  subscribeSignature(signature):
    ws.signatureSubscribe(signature, { commitment: 'finalized' })
    on notification: (result) =>
      if result.err === null → TX_SUCCESS
      else → TX_FAILED_ON_CHAIN
```

| 항목 | 값 |
|------|-----|
| 복잡도 | 중간 |
| 의존성 | RPC 클라이언트, WebSocket 클라이언트, nonce pool |
| 리스크 | 높음 (TX 랜딩 안정성, Risk 1 참조) |
| 추정 기간 | 1주 |

---

## 5. ATA 라이프사이클 관리

### 무엇이 다른가

EVM에서는 ERC-20 토큰 전송 시 수신자 주소에 별도 계정 생성이 불필요하다. Solana에서는 SPL 토큰을 수신하려면 해당 (지갑, 토큰 mint) 쌍의 ATA가 존재해야 한다.

```
EVM:
  ERC20.transfer(to, amount) → 수신자 계정 자동 처리
  비용: 가스비만

Solana:
  1. ATA 존재 확인: getAccountInfo(ata_address)
  2. ATA 없으면: createAssociatedTokenAccount(payer, wallet, mint)
  3. SPL Token transfer
  비용: ATA rent (~0.002 SOL) + TX 수수료
```

### 구현 내용

```
ATAManager:

  ensureATA(walletAddress, mintAddress):
    ataAddress = getAssociatedTokenAddress(walletAddress, mintAddress)
    accountInfo = getAccountInfo(ataAddress)

    if accountInfo exists:
      return { ataAddress, status: 'EXISTS' }
    else:
      return { ataAddress, status: 'NEEDS_CREATION' }

  createATAInstruction(payer, walletAddress, mintAddress):
    return createAssociatedTokenAccountIdempotent({
      payer: payer,
      associatedToken: ataAddress,
      owner: walletAddress,
      mint: mintAddress
    })
    // Idempotent: 이미 존재하면 no-op, 없으면 생성

  closeUnusedATAs():
    // 배치: 잔액 0 + 30일 미사용 ATA 폐쇄
    atas = query("SELECT * FROM solana_ata_accounts
                  WHERE status = 'ACTIVE'
                  AND balance = 0
                  AND last_activity < NOW() - INTERVAL '30 days'")

    for ata in atas:
      closeAccountInstruction = Token.createCloseAccountInstruction(
        ata.ata_address,  // 폐쇄할 ATA
        payer,            // rent 환불 받을 주소
        ata.wallet_address // ATA 소유자
      )
      // TX 전송 → 성공 시 DB 상태 CLOSED로 업데이트
```

| 항목 | 값 |
|------|-----|
| 복잡도 | 중간 |
| 의존성 | RPC 클라이언트, 토큰 프로그램 라이브러리 |
| 리스크 | 중간 (Risk 4 참조, 비용 관리 필요) |
| 추정 기간 | 0.5주 |

---

## 신규 구현 요약

| 컴포넌트 | 복잡도 | 리스크 | 추정 기간 | 우선 의존성 |
|---------|--------|--------|----------|-----------|
| 슬롯 기반 블록 스캐닝 | 중간 | 중간 | 1주 | RPC 클라이언트 |
| Balance diff 전송 추출 | 높음 | 중간 | 1.5주 | Block Publisher |
| Durable nonce 풀 관리 | 높음 | 높음 | 1.5주 | KMS signer |
| 적극적 TX 재전송 | 중간 | 높음 | 1주 | Nonce pool |
| ATA 라이프사이클 관리 | 중간 | 중간 | 0.5주 | RPC 클라이언트 |
| **합계** | | | **~5.5주** | |

이 5.5주의 신규 개발 작업이 12주 로드맵의 핵심이다. 나머지 시간은 기존 인프라 연동, 테스트, 부하 검증, 운영 준비에 사용된다.

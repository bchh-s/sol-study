# 10.2 잔액/계정 조회 RPC

상위 섹션: [10. RPC API 레퍼런스](../README.md)

## 개요

Dagaon Core의 Balance Checker와 Deposit Monitor가 사용하는 계정/잔액 조회 메서드 5개를 다룬다.

Solana의 계정 모델은 EVM과 근본적으로 다르다:
- EVM: 주소에 ETH 잔액이 직접 저장됨
- Solana: 모든 것이 "계정(Account)"이며, SOL 잔액은 계정의 lamports 필드

---

## getBalance

특정 주소의 SOL 잔액을 lamports 단위로 반환한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| pubkey | string | 예 | base58 주소 |
| commitment | string | 아니오 | "processed", "confirmed", "finalized" |
| minContextSlot | number | 아니오 | 최소 슬롯 컨텍스트 |

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getBalance",
  "params": [
    "DRpbCBMxVnDK7maPMoKsdTdEC1a4NoLc8cmm7RFJ3quP",
    {
      "commitment": "finalized"
    }
  ]
}
```

### 응답

```json
{
  "jsonrpc": "2.0",
  "result": {
    "context": {
      "slot": 332558490,
      "apiVersion": "2.0.15"
    },
    "value": 1500000000
  },
  "id": 1
}
```

- `value`: lamports 단위 (1 SOL = 1,000,000,000 lamports = 10^9)
- `context.slot`: 이 조회가 실행된 시점의 슬롯

### EVM 대응: eth_getBalance

```
EVM:
  eth_getBalance("0xaddr", "latest") -> "0x0de0b6b3a7640000" (1 ETH in wei, hex)
  단위: wei (1 ETH = 10^18 wei)

Solana:
  getBalance("addr", {commitment: "finalized"}) -> 1000000000 (1 SOL in lamports, decimal)
  단위: lamports (1 SOL = 10^9 lamports)
```

차이점:
- EVM은 hex 문자열, Solana는 정수
- EVM은 block number 또는 "latest", Solana는 commitment

---

## getAccountInfo

계정의 전체 정보를 반환한다. SOL 잔액뿐 아니라 데이터, 소유 프로그램 등 모든 정보를 포함.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| pubkey | string | 예 | base58 주소 |
| encoding | string | 아니오 | "base58", "base64", "base64+zstd", "jsonParsed" |
| commitment | string | 아니오 | commitment 레벨 |
| dataSlice | object | 아니오 | { offset, length } - 데이터 일부만 조회 |
| minContextSlot | number | 아니오 | 최소 슬롯 컨텍스트 |

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getAccountInfo",
  "params": [
    "DRpbCBMxVnDK7maPMoKsdTdEC1a4NoLc8cmm7RFJ3quP",
    {
      "encoding": "jsonParsed",
      "commitment": "finalized"
    }
  ]
}
```

### 응답: 일반 지갑 (System Account)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "context": { "slot": 332558490 },
    "value": {
      "data": ["", "base64"],
      "executable": false,
      "lamports": 1500000000,
      "owner": "11111111111111111111111111111111",
      "rentEpoch": 18446744073709551615,
      "space": 0
    }
  },
  "id": 1
}
```

### 응답: Token Account (jsonParsed encoding)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "context": { "slot": 332558490 },
    "value": {
      "data": {
        "parsed": {
          "info": {
            "isNative": false,
            "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "owner": "DRpbCBMxVnDK7maPMoKsd...",
            "state": "initialized",
            "tokenAmount": {
              "amount": "1000000",
              "decimals": 6,
              "uiAmount": 1.0,
              "uiAmountString": "1"
            }
          },
          "type": "account"
        },
        "program": "spl-token",
        "space": 165
      },
      "executable": false,
      "lamports": 2039280,
      "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "rentEpoch": 18446744073709551615,
      "space": 165
    }
  },
  "id": 1
}
```

### 계정 필드 설명

| 필드 | 설명 |
|------|------|
| lamports | SOL 잔액 (lamports 단위). 모든 계정이 가짐 |
| owner | 이 계정을 소유하는 프로그램. System Program이면 일반 지갑, Token Program이면 토큰 계정 |
| data | 계정에 저장된 데이터. 일반 지갑은 비어있음, 토큰 계정은 토큰 정보 |
| executable | 프로그램(스마트 컨트랙트) 계정인지 여부 |
| rentEpoch | rent 관련 epoch. 18446744073709551615면 rent-exempt (영구) |
| space | 데이터 크기 (bytes) |

### Dagaon Core 사용

- **Durable Nonce 계정 조회**: `getAccountInfo`로 stored_nonce 값 읽기
- **Token Account 존재 확인**: 입금 주소에 ATA가 생성되었는지 확인
- **계정 유효성 검증**: 출금 대상 주소가 실제 존재하는지 확인

---

## getTokenAccountsByOwner

특정 소유자(지갑)의 모든 SPL Token 계정을 조회한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| pubkey | string | 예 | 소유자 지갑 주소 |
| filter | object | 예 | `{mint: "..."}` 또는 `{programId: "TokenkegQ..."}` |
| encoding | string | 아니오 | "base64", "jsonParsed" 등 |
| commitment | string | 아니오 | commitment 레벨 |

### 요청: 특정 토큰의 계정만 조회

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTokenAccountsByOwner",
  "params": [
    "DRpbCBMxVnDK7maPMoKsdTdEC1a4NoLc8cmm7RFJ3quP",
    {
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    },
    {
      "encoding": "jsonParsed",
      "commitment": "finalized"
    }
  ]
}
```

### 요청: 모든 SPL Token 계정 조회

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTokenAccountsByOwner",
  "params": [
    "DRpbCBMxVnDK7maPMoKsdTdEC1a4NoLc8cmm7RFJ3quP",
    {
      "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    },
    {
      "encoding": "jsonParsed",
      "commitment": "finalized"
    }
  ]
}
```

### 응답

```json
{
  "jsonrpc": "2.0",
  "result": {
    "context": { "slot": 332558490 },
    "value": [
      {
        "account": {
          "data": {
            "parsed": {
              "info": {
                "isNative": false,
                "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                "owner": "DRpbCBMxVnDK7maPMoKsd...",
                "state": "initialized",
                "tokenAmount": {
                  "amount": "1000000",
                  "decimals": 6,
                  "uiAmount": 1.0,
                  "uiAmountString": "1"
                }
              },
              "type": "account"
            },
            "program": "spl-token",
            "space": 165
          },
          "executable": false,
          "lamports": 2039280,
          "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          "rentEpoch": 18446744073709551615,
          "space": 165
        },
        "pubkey": "Czc8QHUmjJBNPAK3mSqbg2cXJdRJxPu9SgkqRmAKS8eE"
      }
    ]
  },
  "id": 1
}
```

### EVM과의 비교

```
EVM에서 특정 지갑의 ERC20 잔액 조회:
  1. 각 토큰 컨트랙트마다 balanceOf(address)를 개별 호출
  2. 또는 Multicall 컨트랙트로 배치 호출
  3. 토큰 목록을 미리 알아야 함

Solana에서:
  1. getTokenAccountsByOwner(address, {programId: TokenProgram})로 한 번에 모든 토큰 계정 조회
  2. 토큰 목록을 미리 알 필요 없음
  3. 각 계정의 mint, amount, decimals 모두 포함
```

Solana가 더 간편하다.

---

## getTokenAccountBalance

특정 토큰 계정(Token Account)의 잔액을 조회한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| pubkey | string | 예 | Token Account 주소 (지갑 주소가 아님!) |
| commitment | string | 아니오 | commitment 레벨 |

주의: 입력은 **소유자 지갑 주소**가 아니라 **Token Account 주소**이다.

### Token Account 주소 유도 (ATA)

```
Associated Token Account (ATA) 주소 계산:
  PDA = findProgramAddress(
    [ownerAddress, TOKEN_PROGRAM_ID, mintAddress],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

예시:
  owner = "DRpbCBMxVnDK7maPMoKsd..."
  mint  = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" (USDC)
  ATA   = "Czc8QHUmjJBNPAK3mSqbg2cXJdRJxPu9SgkqRmAKS8eE" (deterministic)
```

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTokenAccountBalance",
  "params": [
    "Czc8QHUmjJBNPAK3mSqbg2cXJdRJxPu9SgkqRmAKS8eE",
    {
      "commitment": "finalized"
    }
  ]
}
```

### 응답

```json
{
  "jsonrpc": "2.0",
  "result": {
    "context": { "slot": 332558490 },
    "value": {
      "amount": "1000000",
      "decimals": 6,
      "uiAmount": 1.0,
      "uiAmountString": "1"
    }
  },
  "id": 1
}
```

- `amount`: raw 정수 문자열 (DB에 이 값을 저장)
- `decimals`: 토큰의 소수점 자릿수 (USDC = 6)
- `uiAmount`: 사람이 읽기 좋은 값 (amount / 10^decimals)
- `uiAmountString`: uiAmount의 문자열 버전 (정밀도 유지)

---

## getMinimumBalanceForRentExemption

특정 크기의 데이터를 영구적으로 저장하기 위해 필요한 최소 SOL 잔액(rent-exempt)을 계산한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| dataSize | usize | 예 | 계정 데이터 크기 (bytes) |
| commitment | string | 아니오 | commitment 레벨 |

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getMinimumBalanceForRentExemption",
  "params": [165]
}
```

### 응답

```json
{
  "jsonrpc": "2.0",
  "result": 2039280,
  "id": 1
}
```

`result` = 2,039,280 lamports = 약 0.00204 SOL

### 주요 데이터 크기별 rent-exempt 비용

| 계정 유형 | 데이터 크기 | rent-exempt (lamports) | SOL |
|----------|-----------|----------------------|-----|
| Token Account | 165 bytes | 2,039,280 | ~0.00204 |
| Mint Account | 82 bytes | 1,461,600 | ~0.00146 |
| Nonce Account | 80 bytes | 1,447,680 | ~0.00145 |
| System Account | 0 bytes | 890,880 | ~0.00089 |

### EVM과의 비교

```
EVM:
  - 계정 생성 비용 없음 (빈 주소에도 전송 가능)
  - storage 비용은 gas로 지불 (SSTORE)

Solana:
  - 모든 계정이 rent-exempt deposit 필요
  - Token Account 생성: ~0.00204 SOL
  - 이 비용은 fee_payer가 부담
  - 계정 폐쇄 시 deposit 회수 가능
```

### Dagaon Core 사용

- **Deposit 지갑의 ATA 생성 비용 계산**: `getMinimumBalanceForRentExemption(165)`
- **Nonce 계정 생성 비용 계산**: `getMinimumBalanceForRentExemption(80)`
- **fee_payer SOL 예산 산정**: (ATA 생성 수 * rent-exempt) + (TX 수수료 * TX 수)

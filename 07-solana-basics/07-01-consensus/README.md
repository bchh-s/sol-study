# 7.1 합의 메커니즘

상위 섹션: [7. Solana 기초 개념 상세](../README.md)

## 개요

Solana의 합의는 두 가지 핵심 메커니즘의 결합이다:

1. **Proof of History (PoH)**: SHA-256 해시 체인으로 시간 순서를 증명
2. **Tower BFT**: PBFT 변형으로 validator 합의를 달성

PoH가 "언제"를 결정하고, Tower BFT가 "무엇이 확정되었는지"를 결정한다.

---

## Proof of History (PoH)

### 핵심 원리

PoH는 **Verifiable Delay Function (VDF)** 의 일종으로,
SHA-256 해시를 순차적으로 체이닝하여 "시간이 흘렀음"을 암호학적으로 증명한다.

```
해시 체인:

hash_0 = SHA-256("초기값")
hash_1 = SHA-256(hash_0)
hash_2 = SHA-256(hash_1)
hash_3 = SHA-256(hash_2)
...
hash_N = SHA-256(hash_{N-1})

→ hash_N을 만들려면 반드시 N번의 SHA-256 연산을 순차적으로 수행해야 함
→ 병렬화 불가능 → "시간이 흘렀다"는 증거
```

### 이벤트 포함

트랜잭션이나 이벤트를 해시 체인에 삽입할 수 있다:

```
hash_100 = SHA-256(hash_99)
hash_101 = SHA-256(hash_100)
hash_102 = SHA-256(hash_101 + event_data)   ← 이벤트 삽입
hash_103 = SHA-256(hash_102)
hash_104 = SHA-256(hash_103)

→ event_data는 반드시 hash_101과 hash_103 사이에 발생했음을 증명
→ 다른 validator는 이 체인을 빠르게 검증 가능 (병렬 검증)
```

### PoH가 해결하는 문제

```
기존 블록체인 (EVM 포함):
  - 블록 생산자가 TX를 수집
  - 블록에 타임스탬프를 부여 (신뢰 불가)
  - 다른 노드들이 블록 도착 시간으로 순서 추론
  → 합의에 시간과 메시지 교환이 많이 필요

Solana (PoH):
  - Leader가 PoH 해시 체인을 계속 생성
  - TX를 체인에 삽입하면 순서가 자동으로 결정
  - 다른 validator는 해시 체인만 검증하면 순서를 확인
  → 합의 전에 이미 순서가 결정됨 → 합의 속도 향상
```

### 검증 비용

- **생성**: 순차적 SHA-256 → 단일 코어에서 초당 ~수천만 해시
- **검증**: 병렬화 가능 → GPU나 멀티코어로 생성보다 훨씬 빠르게 검증
- 이 비대칭성이 Solana의 성능 핵심

---

## Tower BFT

### PBFT 대비 차이점

Tower BFT는 Practical Byzantine Fault Tolerance (PBFT)의 변형이다.
핵심 차이는 **PoH를 글로벌 시계로 사용**하여 통신 비용을 줄인다는 점이다.

```
PBFT:
  Pre-prepare → Prepare → Commit
  → O(n^2) 메시지 복잡도 (모든 노드가 서로 통신)

Tower BFT:
  PoH로 순서 확정 → 투표 → Lockout 기반 확정
  → O(n) 메시지 복잡도 (validator → leader 단방향 투표)
```

### 투표 메커니즘

Validator들은 **포크(fork)**에 투표한다. 개별 블록이 아닌 "이 포크가 정당하다"에 투표한다.

```
Slot 100: Block A ← Validator 1, 2, 3 투표
         └─ Block B ← Validator 4 투표 (포크)

Slot 101: Block A' (A의 자식) ← Validator 1, 2, 3, 5 투표
          Block B' (B의 자식) ← Validator 4 투표

→ 66% supermajority가 A 포크에 투표 → confirmed
```

### 지수적 Lockout (Exponential Lockout)

Tower BFT의 핵심 안전 메커니즘이다.

```
투표가 깊어질수록 lockout이 기하급수적으로 증가:

투표 깊이 N | Lockout (슬롯) | 의미
-----------|---------------|------
    1      |     2         | 2 슬롯 동안 다른 포크에 투표 불가
    2      |     4         | 4 슬롯 동안 변경 불가
    3      |     8         | 8 슬롯 동안 변경 불가
    ...    |    ...        |
   32      | 2^32 = ~50일  | 사실상 영구 확정

→ validator가 포크 A에 32번 연속 투표하면,
  다른 포크로 전환하려면 2^32 슬롯(~50일)을 기다려야 함
→ 깊은 reorg는 사실상 불가능
```

**슬래싱:** lockout 기간 중 다른 포크에 투표하면 스테이킹된 SOL이 슬래싱된다.
→ 경제적 불이익으로 악의적 행동을 억제

---

## Commitment 수준

Solana RPC는 세 가지 commitment 수준을 제공한다:

```
processed → confirmed → finalized

[processed]
  - Leader가 TX를 처리하고 블록에 포함
  - 아직 다른 validator의 투표 없음
  - Reorg 가능성: 있음
  - 지연: ~400ms (1 슬롯)

[confirmed]
  - Cluster의 66% supermajority가 해당 블록에 투표
  - Reorg 가능성: 매우 낮음 (하지만 이론적으로 가능)
  - 지연: ~400ms~6초 (통상 수 슬롯)

[finalized]
  - 31개 이상의 후속 블록이 confirmed
  - 최대 lockout에 도달 → 사실상 reorg 불가능
  - 지연: ~12~30초
  - EVM의 finality에 해당
```

### Dagaon Core에서의 commitment 사용 지침

```
입금 감지:     confirmed   (빠른 UX, 소액에 적합)
입금 확정:     finalized   (회계 처리, 대금 처리)
출금 성공 판정: confirmed   (유저에게 빠른 피드백)
출금 확정:     finalized   (내부 장부 확정)
잔액 조회:     confirmed   (실시간성과 안정성 절충)
```

---

## Leader Rotation

### 리더 스케줄

각 에포크(epoch, ~2일)마다 validator의 리더 스케줄이 결정적으로 계산된다.

```
에포크 시작 시:
  - 모든 validator의 stake 가중치 수집
  - stake 비율에 따라 슬롯 배정
  - 예: Validator A (10% stake) → 에포크의 ~10% 슬롯에서 리더

리더 스케줄 예시 (연속 4 슬롯씩 배정):
  Slot 100-103: Validator A (리더)
  Slot 104-107: Validator B (리더)
  Slot 108-111: Validator C (리더)
  ...
```

### 리더의 역할

```
1. 트랜잭션 수신 (다른 validator/클라이언트로부터)
2. PoH 해시 체인에 TX 삽입하여 순서 결정
3. 블록(Entry) 생성
4. 다른 validator에게 블록 전파 (Turbine 프로토콜)
5. 리더 슬롯 종료 후 다음 리더에게 역할 전환
```

### Gulf Stream

Solana의 mempool 없는 설계:

```
기존 블록체인:
  TX → Mempool → 리더가 Mempool에서 선택 → 블록

Solana (Gulf Stream):
  TX → 직접 현재/다음 리더에게 전송 → 리더가 즉시 처리

→ Mempool이 없으므로 TX 전파 지연 감소
→ 클라이언트가 리더 스케줄을 알고 있으므로 직접 전송 가능
```

---

## EVM과의 비교

| 항목 | EVM (Ethereum PoS) | Solana (PoH + Tower BFT) |
|------|-------------------|--------------------------|
| 블록 시간 | ~12초 | ~400ms (슬롯) |
| Finality | ~12분 (2 에포크) | ~12~30초 (31 confirmed 블록) |
| 합의 메시지 | O(n^2) | O(n) |
| 순서 결정 | 블록 생산 시 | PoH로 사전 결정 |
| Mempool | 있음 (MEV 문제) | 없음 (Gulf Stream) |
| 리더 선정 | RANDAO + 에포크 | Stake 기반 결정적 스케줄 |
| 슬래싱 조건 | 이중 투표, 서라운드 투표 | Lockout 위반 |

## 참고 링크

- [Solana Consensus - EVM to SVM](https://solana.com/developers/evm-to-svm/consensus)
- [Proof of History Explained](https://solana.com/news/proof-of-history)
- [Tower BFT Paper](https://docs.solanalabs.com/consensus/tower-bft)
- [Solana Cluster](https://solana.com/docs/core/clusters)

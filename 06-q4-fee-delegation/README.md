# 6. Q4: Fee Delegation

## 개요

Solana의 수수료 대납(fee delegation)은 EVM 생태계와 근본적으로 다르다.
EVM에서는 메타 트랜잭션(EIP-2771), Account Abstraction(EIP-4337), Permit(EIP-2612) 등
별도의 컨트랙트와 릴레이 인프라를 구축해야 가스비 대납이 가능하지만,
Solana에서는 **트랜잭션의 첫 번째 서명자가 자동으로 fee payer**가 되는 네이티브 모델을 사용한다.

이 차이는 Dagaon Core 같은 커스터디얼 서비스에서 특히 극적이다.
EVM에서 deposit 지갑에 가스비를 공급하던 복잡한 파이프라인이
Solana에서는 단순히 핫월렛을 fee payer로 지정하는 것만으로 대체된다.

## 핵심 요약

| 관점 | EVM | Solana |
|------|-----|--------|
| 수수료 대납 방식 | Forwarder 컨트랙트, Paymaster, Relay 서버 | 트랜잭션 첫 번째 서명자 = fee payer |
| 추가 컨트랙트 배포 | 필요 | 불필요 |
| 릴레이 서버 | 필요 | 불필요 |
| 가스 오버헤드 | 30~50% 추가 | 0% |
| 유저 서명 | 필요 (meta-tx) | 커스터디얼이면 불필요 |
| 구현 복잡도 | 높음 | 최소 |

## 학습 순서

1. **[결론: 네이티브 Fee Payer](./01-conclusion-native-fee-payer/README.md)** - Solana가 왜 간단한지 한눈에 파악
2. **[6.1 Fee Payer 모델](./06-01-fee-payer-model/README.md)** - 첫 번째 서명자 = fee payer 메커니즘 상세
3. **[6.2 EVM과의 비교](./06-02-evm-comparison/README.md)** - EIP-2771, EIP-4337, Permit2와 체계적 비교
4. **[6.3 커스터디얼 모델 적용](./06-03-custodial-application/README.md)** - Dagaon Core에서의 실제 적용 방안
5. **[6.4 Fee 구조 상세](./06-04-fee-structure/README.md)** - Base fee, Priority fee, Compute Unit, 로컬 fee 시장

## Dagaon Core 관점에서 중요한 이유

Dagaon Core의 EVM 체인 지원에서 가스비 대납은 가장 복잡한 파이프라인 중 하나다:

```
[EVM 현재 구조]
1. 유저 deposit 지갑 생성
2. deposit 지갑에 가스비(ETH) 공급 → gas-supply 모듈 필요
3. 가스비 부족 감지 → 모니터링 필요
4. 가스비 재공급 → 별도 트랜잭션 필요
5. Forwarder/Paymaster 컨트랙트 배포 → 체인별 관리 필요
6. Relay 서버 운영 → 인프라 관리 필요

[Solana 구조]
1. 유저 deposit 지갑 생성
2. 핫월렛을 fee payer로 지정 → 끝
```

가스비 공급 모듈, 잔액 모니터링, Relay 서버가 전부 불필요해진다.

## 참고 링크

- [Solana Transactions](https://solana.com/docs/core/transactions)
- [Solana Fees](https://solana.com/docs/core/fees)
- [Solana Transaction Confirmation](https://solana.com/developers/guides/advanced/confirmation)
- [Add Solana to Your Exchange](https://solana.com/developers/guides/advanced/exchange)

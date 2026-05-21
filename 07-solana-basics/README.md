# 7. Solana 기초 개념 상세

## 개요

Solana 체인 통합 구현에 필요한 기초 개념을 정리한다.
EVM 개발 경험이 있는 엔지니어가 Solana로 전환할 때 반드시 이해해야 하는
합의 메커니즘, 계정 모델, 토큰 시스템, 트랜잭션 구조, 프로그램 아키텍처를 다룬다.

Solana는 EVM과 근본적으로 다른 설계 철학을 가지고 있다:

| 관점 | EVM | Solana |
|------|-----|--------|
| 상태 저장 | 컨트랙트 내부 storage slots | 외부 account의 data 필드 |
| 코드 실행 | 상태와 코드가 하나의 주소 | 코드(program)와 상태(account)가 분리 |
| 합의 | PoS + finality gadget | PoH + Tower BFT |
| 트랜잭션 | 단일 서명자 | 다중 서명자 |
| 토큰 | 컨트랙트 내부 mapping | 별도 토큰 계정 (ATA) |
| 수수료 | 글로벌 fee market | 로컬 fee market (프로그램별) |

## 학습 순서

1. **[7.1 합의 메커니즘](./07-01-consensus/README.md)** - PoH, Tower BFT, Leader Rotation
2. **[7.2 계정 모델](./07-02-account-model/README.md)** - 5가지 필드, Rent, PDA
3. **[7.3 Associated Token Account](./07-03-associated-token-account/README.md)** - ATA 도출, 생성, 비용
4. **[7.4 Transaction 구조](./07-04-transaction-structure/README.md)** - Legacy vs v0, 1232 byte 제한, ALT
5. **[7.5 프로그램](./07-05-programs/README.md)** - System/Token/ATA Program, CPI

## 실습 코드

- **[Account Explorer](./code/account-explorer.ts)** - devnet에서 다양한 계정 유형을 조회하고 비교하는 스크립트

## 핵심 용어 Glossary

| 용어 | 설명 |
|------|------|
| **Slot** | 블록 생산 시간 단위 (~400ms) |
| **Block Height** | 생성된 블록의 순번 (slot != block height, 빈 슬롯 존재) |
| **Epoch** | 432,000 슬롯 (~2일), stake 가중치 재계산 주기 |
| **Commitment** | TX 확인 수준: `processed` → `confirmed` → `finalized` |
| **Account** | Solana의 기본 저장 단위 (모든 것이 계정) |
| **Owner** | 계정의 data를 수정할 수 있는 프로그램 |
| **Lamports** | SOL의 최소 단위 (1 SOL = 1,000,000,000 lamports) |
| **PDA** | Program Derived Address, 프로그램이 결정적으로 도출한 주소 |
| **ATA** | Associated Token Account, 지갑+mint으로 결정되는 토큰 계정 |
| **CU** | Compute Unit, 명령어 실행 비용 단위 |

## 참고 링크

- [Solana Developer Docs](https://solana.com/docs)
- [Solana Cookbook](https://solanacookbook.com)
- [EVM to SVM Guide](https://solana.com/developers/evm-to-svm)
- [Solana Transactions](https://solana.com/docs/core/transactions)
- [Solana Fees](https://solana.com/docs/core/fees)
- [Solana Account Model](https://solana.com/docs/core/accounts)
- [SPL Token Documentation](https://spl.solana.com/token)

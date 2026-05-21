# 15. 참고자료

## 이 섹션의 활용 방법

이 참고자료는 단순한 링크 모음이 아니라, **학습 순서와 맥락**을 제공한다. 각 자료에 대해 다음 정보를 포함한다:

- **무엇을 다루는가:** 문서의 핵심 내용
- **언제 참고하는가:** 어떤 작업/결정에서 이 문서를 봐야 하는지
- **Dagaon Core 통합에 미치는 영향:** 이 문서에서 우리에게 중요한 포인트

## 권장 학습 순서

### 1순위: 핵심 개념 (Phase 1 착수 전 필독)

| 순서 | 문서 | 이유 |
|------|------|------|
| 1 | Solana Transactions | TX 구조의 기본 이해 |
| 2 | Transaction Confirmation & Expiration | commitment level, blockhash 만료 이해 |
| 3 | Durable Nonces | 출금 파이프라인의 핵심 메커니즘 |
| 4 | Retrying Transactions | TX 랜딩 전략의 근거 |

### 2순위: 통합 가이드 (Phase 2-3 착수 전)

| 순서 | 문서 | 이유 |
|------|------|------|
| 5 | Add Solana to Your Exchange | 거래소 통합 베스트 프랙티스 |
| 6 | Solana Fees | 수수료 구조 이해 |
| 7 | RPC HTTP / WebSocket | API 사용법 |
| 8 | EVM to SVM Complete Guide | EVM 개발자 관점의 전환 가이드 |

### 3순위: 심화 자료 (Phase 3-4에서 필요 시)

| 순서 | 문서 | 이유 |
|------|------|------|
| 9 | Helius 블로그 시리즈 | 실전 운영 노하우 |
| 10 | KMS 서명 블로그/문서 | KMS 구현 상세 |
| 11 | 라이브러리 문서 | SDK 사용법 |

## 하위 카테고리

- [Solana 공식 문서](./01-solana-official-docs/README.md) -- 1차 출처, 가장 신뢰할 수 있는 자료
- [기술 블로그](./02-technical-blogs/README.md) -- 실전 경험 기반의 심화 자료
- [AWS KMS](./03-aws-kms/README.md) -- Ed25519 서명 관련 AWS 문서
- [라이브러리](./04-libraries/README.md) -- 개발에 사용할 SDK/패키지

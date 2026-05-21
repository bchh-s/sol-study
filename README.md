# Solana 통합 개발/학습 워크스페이스

이 디렉터리는 `solana-integration-research.md`의 주요 header별로 만든 개발/학습 폴더입니다.

## 폴더 목록

- [1. 배경](./01-background/README.md)
- [2. EVM vs Solana 핵심 차이 요약](./02-evm-vs-solana/README.md)
- [3. Q1: Block Sync 아키텍처 호환성](./03-q1-block-sync/README.md)
- [4. Q2: KMS Solana 지원 가능 여부](./04-q2-kms-solana/README.md)
- [5. Q3: TX 전송 및 재전송 방식](./05-q3-tx-send-retry/README.md)
- [6. Q4: Fee Delegation](./06-q4-fee-delegation/README.md)
- [7. Solana 기초 개념 상세](./07-solana-basics/README.md)
- [8. 컴포넌트별 영향도 분석](./08-component-impact/README.md)
- [9. DB 스키마 영향](./09-db-schema/README.md)
- [10. RPC API 레퍼런스](./10-rpc-api/README.md)
- [11. 리스크 평가](./11-risk-assessment/README.md)
- [12. Architecture Decision Records](./12-adr/README.md)
- [13. 구현 페이즈](./13-implementation-phases/README.md)
- [14. 결론](./14-conclusion/README.md)
- [15. 참고자료](./15-references/README.md)

## 추천 진행 순서

1. 07 Solana 기초 개념 상세
2. 02 EVM vs Solana 핵심 차이 요약
3. 03 Block Sync와 10 RPC API
4. 04 KMS와 05 TX 전송/재전송
5. 09 DB 스키마와 11 리스크
6. 12 ADR과 13 구현 페이즈로 최종 계획화

## 리서치 확인 메모

- 공식 Solana 문서 페이지(Transactions, Fees, Durable Nonces, getBlock, Confirmation, Retry, Exchange guide)와 AWS KMS Key Spec Reference 접근 가능성을 확인했다.
- 각 README는 원문 요약이 아니라, 개발자가 바로 학습/PoC/구현 계획으로 옮길 수 있도록 `개발할 내용`, `공부할 내용`, `실습/검증 과제`, `완료 기준`으로 구성했다.

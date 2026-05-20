# 중간 리스크

상위 섹션: [11. 리스크 평가](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

| # | 리스크 | 영향 | 대응 |
|---|--------|------|------|
| 4 | **ATA 라이프사이클** | 토큰별 계정 생성 비용 (~0.002 SOL) | Lazy 생성, 핫월렛이 비용 부담, close 시 반환 |
| 5 | **실패 TX 비용 회계** | 실패해도 5,000 lamports 소비 | 회계 로직에 실패 TX fee 추적 추가 |
| 6 | **주소 포맷 전환** | VARCHAR(42) → VARCHAR(44), hex → base58 | Solana 전용 테이블 분리로 해결 |

## 개발할 내용

1. 리스크별 metric, alert, runbook, fallback을 정의한다.
2. 이 항목이 상위 파이프라인에서 들어갈 정확한 컴포넌트와 입력/출력 DTO를 적는다.
3. 실패 케이스, 재시도, idempotency, 모니터링 포인트를 최소 1개 이상 정의한다.

## 공부할 내용

1. Solana 장애/혼잡 사례와 provider failover 전략을 조사한다.
2. EVM 현재 구현의 대응 개념과 차이점을 한 문단으로 비교한다.
3. 문서 내용이 실제 RPC/SDK 응답과 맞는지 샘플로 확인한다.

## 실습/검증 과제

1. chaos/drill 시나리오와 알림 임계값을 작성한다.
2. fixture 또는 명령 실행 결과를 이 폴더에 `notes.md`나 `fixtures/`로 남긴다.
3. 구현 전에 acceptance criteria 3개를 체크박스로 작성한다.

## 완료 기준

- 개념 설명, 구현 위치, 테스트/검증 방법이 모두 문서화되어 있다.
- 공식 문서 링크나 실제 devnet/mainnet 응답 중 하나로 가정을 확인했다.
- 상위 섹션 README의 완료 기준을 충족하는 데 기여한다.

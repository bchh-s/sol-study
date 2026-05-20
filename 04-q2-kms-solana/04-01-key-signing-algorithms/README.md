# 4.1 키/서명 알고리즘 비교

상위 섹션: [4. Q2: KMS Solana 지원 가능 여부](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

| 항목 | EVM | Solana |
|------|-----|--------|
| 곡선 | secp256k1 (Koblitz) | Ed25519 (Edwards) |
| 서명 방식 | ECDSA (랜덤 nonce 사용) | EdDSA (결정적, 동일 입력 = 동일 서명) |
| 개인키 크기 | 32 bytes | 32 bytes (seed) 또는 64 bytes (seed+pubkey) |
| 공개키 크기 | 64 bytes (비압축) / 33 bytes (압축) | 32 bytes |
| 서명 크기 | 65 bytes (r, s, v) | 64 bytes |
| 주소 길이 | 20 bytes → 42자 hex | 32 bytes → 32-44자 base58 |
| 주소 = 공개키? | 아니요 (keccak256 해시) | 예 (공개키 = 주소) |
| BIP-44 경로 | m/44'/60'/0'/0/0 | m/44'/501'/0'/0' |

## 개발할 내용

1. KMS/서명 PoC와 golden test를 작성한다.
2. 이 항목이 상위 파이프라인에서 들어갈 정확한 컴포넌트와 입력/출력 DTO를 적는다.
3. 실패 케이스, 재시도, idempotency, 모니터링 포인트를 최소 1개 이상 정의한다.

## 공부할 내용

1. Ed25519, DER public key, RAW signing, base58 address derivation을 학습한다.
2. EVM 현재 구현의 대응 개념과 차이점을 한 문단으로 비교한다.
3. 문서 내용이 실제 RPC/SDK 응답과 맞는지 샘플로 확인한다.

## 실습/검증 과제

1. 동일 message에 대한 verify 테스트와 latency 측정을 수행한다.
2. fixture 또는 명령 실행 결과를 이 폴더에 `notes.md`나 `fixtures/`로 남긴다.
3. 구현 전에 acceptance criteria 3개를 체크박스로 작성한다.

## 완료 기준

- 개념 설명, 구현 위치, 테스트/검증 방법이 모두 문서화되어 있다.
- 공식 문서 링크나 실제 devnet/mainnet 응답 중 하나로 가정을 확인했다.
- 상위 섹션 README의 완료 기준을 충족하는 데 기여한다.

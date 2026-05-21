# 4.5 듀얼 체인 KMS 아키텍처

상위 섹션: [4. Q2: KMS Solana 지원 가능 여부](../README.md)

---

## 요약

단일 AWS KMS 인스턴스에서 EVM(secp256k1)과 Solana(Ed25519)를 동시에 관리하는 아키텍처를 설계한다.
인프라 중복 없이, 라우팅 로직만 추가하면 된다.

---

## 아키텍처 다이어그램

```
                         Dagaon Core
                              │
                    ┌─────────┴─────────┐
                    │   Chain Router     │
                    │   (chain_type)     │
                    └─────────┬─────────┘
                              │
               ┌──────────────┴──────────────┐
               ▼                              ▼
    ┌─────────────────────┐      ┌─────────────────────────┐
    │   EVM Signer Module │      │   Solana Signer Module   │
    │                     │      │                          │
    │   - RLP 인코딩       │      │   - Solana TX 빌드       │
    │   - keccak256 해싱   │      │   - Message 직렬화       │
    │   - DER → r,s,v     │      │   - RAW 메시지 전달       │
    │   - hex 주소 도출    │      │   - base58 주소 도출      │
    └──────────┬──────────┘      └────────────┬────────────┘
               │                              │
               └──────────────┬───────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   AWS KMS Client   │
                    │   (공통 SDK 래퍼)   │
                    └─────────┬─────────┘
                              │
                    ┌─────────┴─────────────────────┐
                    │        AWS KMS Instance         │
                    │                                 │
                    │   CMK-EVM-001 (secp256k1)      │
                    │   CMK-EVM-002 (secp256k1)      │
                    │   CMK-EVM-003 (secp256k1)      │
                    │   CMK-SOL-001 (Ed25519)    ★   │
                    │   CMK-SOL-002 (Ed25519)    ★   │
                    │   CMK-SOL-003 (Ed25519)    ★   │
                    │                                 │
                    └─────────────────────────────────┘

★ = 신규 추가 (Ed25519 키)
```

핵심: AWS KMS 인스턴스는 하나이다. 그 안에 서로 다른 타입의 키가 공존한다.

---

## 키 관리 전략

### key_id -> chain_type 매핑

모든 KMS 키는 `key_id`(UUID 또는 ARN)로 식별된다.
Dagaon Core는 각 key_id가 어떤 체인에 속하는지 알아야 한다.

```
┌──────────────────────────────────────────────────────────────────┐
│                    Key Metadata Store (DB)                        │
├──────────────┬────────────┬──────────┬──────────┬───────────────┤
│ key_id       │ chain_type │ key_spec │ alias    │ address       │
├──────────────┼────────────┼──────────┼──────────┼───────────────┤
│ abc-123-...  │ EVM        │ secp256k1│ evm-001  │ 0x742d35...   │
│ def-456-...  │ EVM        │ secp256k1│ evm-002  │ 0x8ba1f1...   │
│ ghi-789-...  │ SOLANA     │ ed25519  │ sol-001  │ 7xKXtg2C...  │
│ jkl-012-...  │ SOLANA     │ ed25519  │ sol-002  │ 9xQeWvG8...  │
└──────────────┴────────────┴──────────┴──────────┴───────────────┘
```

### AWS Tags로 키 분류

```bash
# EVM 키 태깅
aws kms tag-resource \
  --key-id abc-123-... \
  --tags '[
    {"TagKey":"dagaon:chain","TagValue":"evm"},
    {"TagKey":"dagaon:role","TagValue":"hot-wallet"},
    {"TagKey":"dagaon:env","TagValue":"production"},
    {"TagKey":"dagaon:index","TagValue":"001"}
  ]'

# Solana 키 태깅
aws kms tag-resource \
  --key-id ghi-789-... \
  --tags '[
    {"TagKey":"dagaon:chain","TagValue":"solana"},
    {"TagKey":"dagaon:role","TagValue":"hot-wallet"},
    {"TagKey":"dagaon:env","TagValue":"production"},
    {"TagKey":"dagaon:index","TagValue":"001"}
  ]'
```

### Alias 네이밍 컨벤션

```
패턴: alias/dagaon-{chain}-{role}-{env}-{index}

예시:
alias/dagaon-evm-hot-prod-001     ← EVM 프로덕션 핫월렛 1번
alias/dagaon-evm-hot-prod-002     ← EVM 프로덕션 핫월렛 2번
alias/dagaon-sol-hot-prod-001     ← Solana 프로덕션 핫월렛 1번
alias/dagaon-sol-hot-prod-002     ← Solana 프로덕션 핫월렛 2번
alias/dagaon-evm-cold-prod-001    ← EVM 프로덕션 콜드월렛 1번
alias/dagaon-sol-cold-prod-001    ← Solana 프로덕션 콜드월렛 1번
alias/dagaon-evm-hot-dev-001      ← EVM 개발 핫월렛
alias/dagaon-sol-hot-dev-001      ← Solana 개발 핫월렛
```

---

## 주소 도출 라우터

chain_type에 따라 올바른 주소 도출 로직을 선택한다.

```typescript
// 주소 도출 인터페이스
interface AddressDerivation {
  deriveAddress(derPublicKey: Uint8Array): string;
}

// EVM 주소 도출
class EvmAddressDerivation implements AddressDerivation {
  deriveAddress(derPublicKey: Uint8Array): string {
    // 1. DER 헤더(23B) + 접두사(1B) 제거
    const rawPubKey = derPublicKey.slice(24); // 64 bytes
    
    // 2. keccak256 해싱
    const hash = keccak256(rawPubKey);
    
    // 3. 하위 20바이트 추출 + hex
    return '0x' + Buffer.from(hash.slice(-20)).toString('hex');
  }
}

// Solana 주소 도출
class SolanaAddressDerivation implements AddressDerivation {
  deriveAddress(derPublicKey: Uint8Array): string {
    // 1. DER 헤더(12B) 제거
    const rawPubKey = derPublicKey.slice(12); // 32 bytes
    
    // 2. base58 인코딩 = 주소
    return bs58.encode(rawPubKey);
  }
}

// 라우터
class AddressRouter {
  private derivations: Map<ChainType, AddressDerivation>;
  
  constructor() {
    this.derivations = new Map([
      ['EVM', new EvmAddressDerivation()],
      ['SOLANA', new SolanaAddressDerivation()],
    ]);
  }
  
  deriveAddress(chainType: ChainType, derPublicKey: Uint8Array): string {
    const derivation = this.derivations.get(chainType);
    if (!derivation) {
      throw new Error(`Unsupported chain type: ${chainType}`);
    }
    return derivation.deriveAddress(derPublicKey);
  }
}
```

---

## 서명 라우터

chain_type에 따라 올바른 서명 알고리즘과 MessageType을 선택한다.

```typescript
// 서명 설정 인터페이스
interface SigningConfig {
  signingAlgorithm: string;
  messageType: string;
  prepareMessage(txData: any): Uint8Array;
  processSignature(kmsSignature: Uint8Array, txData: any): any;
}

// EVM 서명 설정
class EvmSigningConfig implements SigningConfig {
  signingAlgorithm = 'ECDSA_SHA_256';
  messageType = 'DIGEST';
  
  prepareMessage(txData: EvmTransaction): Uint8Array {
    // RLP 인코딩 후 keccak256 해싱
    const rlpBytes = rlpEncode(txData);
    return keccak256(rlpBytes); // 32 bytes
  }
  
  processSignature(kmsSignature: Uint8Array, txData: EvmTransaction): SignedEvmTx {
    // DER 파싱 → r, s, v 계산 → signed TX 생성
    const { r, s } = parseDerSignature(kmsSignature);
    const normalizedS = normalizeS(s);
    const v = calculateV(/* ... */);
    return { ...txData, v, r, s: normalizedS };
  }
}

// Solana 서명 설정
class SolanaSigningConfig implements SigningConfig {
  signingAlgorithm = 'EDDSA_ED25519_SHA_512';
  messageType = 'RAW';
  
  prepareMessage(transaction: Transaction): Uint8Array {
    // 메시지 직렬화 (해싱 없이 바로)
    const message = transaction.compileMessage();
    return message.serialize();
  }
  
  processSignature(kmsSignature: Uint8Array, transaction: Transaction): Buffer {
    // 64바이트 서명을 그대로 첨부
    transaction.addSignature(this.publicKey, Buffer.from(kmsSignature));
    return transaction.serialize();
  }
}

// 통합 서명 라우터
class SigningRouter {
  private configs: Map<ChainType, SigningConfig>;
  private kmsClient: KMSClient;
  
  async signTransaction(keyMeta: KeyMetadata, txData: any): Promise<any> {
    const config = this.configs.get(keyMeta.chainType)!;
    
    // 1. 메시지 준비 (체인별 로직)
    const message = config.prepareMessage(txData);
    
    // 2. KMS 서명 (공통 로직)
    const kmsResponse = await this.kmsClient.send(new SignCommand({
      KeyId: keyMeta.keyId,
      Message: message,
      MessageType: config.messageType,
      SigningAlgorithm: config.signingAlgorithm,
    }));
    
    // 3. 서명 후처리 (체인별 로직)
    return config.processSignature(kmsResponse.Signature!, txData);
  }
}
```

---

## 키 생성 워크플로우

새 지갑을 생성할 때의 흐름:

```
                     ┌─────────────────┐
                     │ CreateWallet API │
                     │ (chain_type)     │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ KeySpec 결정     │
                     │ EVM → secp256k1  │
                     │ SOL → Ed25519    │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ KMS CreateKey    │
                     │ + CreateAlias    │
                     │ + TagResource    │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ KMS GetPublicKey │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ 주소 도출 라우터  │
                     │ EVM → hex        │
                     │ SOL → base58     │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ Key Metadata     │
                     │ Store에 저장     │
                     │ (key_id,         │
                     │  chain_type,     │
                     │  address)        │
                     └─────────────────┘
```

```typescript
class KeyManager {
  async createWallet(chainType: ChainType): Promise<WalletInfo> {
    // 1. 체인별 KeySpec 결정
    const keySpec = chainType === 'EVM' 
      ? 'ECC_SECG_P256K1' 
      : 'ECC_NIST_EDWARDS25519';
    
    // 2. KMS 키 생성
    const createResponse = await this.kms.send(new CreateKeyCommand({
      KeySpec: keySpec,
      KeyUsage: 'SIGN_VERIFY',
      Description: `Dagaon ${chainType} wallet`,
      Tags: [
        { TagKey: 'dagaon:chain', TagValue: chainType.toLowerCase() },
        { TagKey: 'dagaon:role', TagValue: 'hot-wallet' },
        { TagKey: 'dagaon:env', TagValue: this.environment },
      ],
    }));
    
    const keyId = createResponse.KeyMetadata!.KeyId!;
    
    // 3. Alias 생성
    const index = await this.getNextIndex(chainType);
    await this.kms.send(new CreateAliasCommand({
      AliasName: `alias/dagaon-${chainType.toLowerCase()}-hot-${this.environment}-${index}`,
      TargetKeyId: keyId,
    }));
    
    // 4. 공개키 추출 + 주소 도출
    const pubKeyResponse = await this.kms.send(new GetPublicKeyCommand({ KeyId: keyId }));
    const address = this.addressRouter.deriveAddress(chainType, pubKeyResponse.PublicKey!);
    
    // 5. 메타데이터 저장
    const metadata: KeyMetadata = {
      keyId,
      chainType,
      keySpec,
      address,
      createdAt: new Date(),
      status: 'active',
    };
    await this.metadataStore.save(metadata);
    
    return { keyId, address, chainType };
  }
}
```

---

## 데이터 모델

### KeyMetadata

```typescript
interface KeyMetadata {
  keyId: string;                    // AWS KMS Key ID (UUID)
  keyArn: string;                   // AWS KMS Key ARN
  chainType: 'EVM' | 'SOLANA';     // 체인 유형
  keySpec: 'ECC_SECG_P256K1' | 'ECC_NIST_EDWARDS25519';
  signingAlgorithm: 'ECDSA_SHA_256' | 'EDDSA_ED25519_SHA_512';
  address: string;                  // 체인별 주소 (hex 또는 base58)
  alias: string;                    // KMS alias
  role: 'hot-wallet' | 'cold-wallet' | 'fee-payer';
  status: 'active' | 'disabled' | 'pending-rotation';
  createdAt: Date;
  lastUsedAt?: Date;
  rotatedFromKeyId?: string;        // 로테이션된 경우 이전 키 ID
}
```

### SigningRequest

```typescript
interface SigningRequest {
  keyId: string;                    // 서명에 사용할 키
  chainType: 'EVM' | 'SOLANA';
  rawTransaction: any;              // 체인별 트랜잭션 데이터
  requestId: string;                // 멱등성 키
  requestedAt: Date;
}
```

### SigningResponse

```typescript
interface SigningResponse {
  requestId: string;
  keyId: string;
  chainType: 'EVM' | 'SOLANA';
  signedTransaction: Uint8Array;    // 서명된 트랜잭션 바이트
  signatureHex: string;             // 서명 hex (로깅/디버깅용)
  signerAddress: string;            // 서명자 주소
  signedAt: Date;
  kmsLatencyMs: number;             // KMS 호출 레이턴시
}
```

---

## 모니터링과 알람

### CloudTrail 이벤트 (자동)

```
모든 KMS API 호출이 CloudTrail에 자동 기록된다:
- kms:Sign → 누가, 언제, 어떤 키로, 어떤 알고리즘으로 서명했는지
- kms:GetPublicKey → 공개키 조회 이력
- kms:CreateKey → 키 생성 이력

체인 타입 구분:
- eventName=Sign, requestParameters.signingAlgorithm=ECDSA_SHA_256 → EVM 서명
- eventName=Sign, requestParameters.signingAlgorithm=EDDSA_ED25519_SHA_512 → Solana 서명
```

### CloudWatch 메트릭 (추가 설정)

```
커스텀 메트릭:
1. dagaon.kms.sign.latency
   - 차원: chain_type, key_alias, environment
   - 알람: p99 > 500ms

2. dagaon.kms.sign.count
   - 차원: chain_type, key_alias, result (success/failure)
   - 알람: failure rate > 1%

3. dagaon.kms.sign.throttle
   - KMS API 스로틀링 발생 횟수
   - 알람: count > 0

4. dagaon.wallet.balance
   - 차원: chain_type, address
   - 알람: balance < minimum_threshold
```

### KMS API Rate Limit

```
AWS KMS Cryptographic Operations 기본 한도:
- Sign: 초당 최대 5,500건 (리전별, 공유)
- GetPublicKey: 초당 최대 5,500건

Dagaon Core 예상 사용량:
- EVM: 현재 ~100 TPS → ~100 Sign/sec
- Solana: 예상 ~200 TPS → ~200 Sign/sec
- 합계: ~300 Sign/sec → 한도의 ~5.5%

여유 충분. 다만 같은 계정의 다른 서비스가 KMS를 사용한다면 합산됨.
별도 계정이나 리전 분리를 고려할 수 있다.
```

---

## 키 로테이션 전략

### 비대칭 키 로테이션 제약

```
AWS KMS 자동 로테이션은 대칭 키에만 적용된다.
비대칭 키(secp256k1, Ed25519)는 수동 로테이션이 필요하다.

수동 로테이션 절차:
1. 새 KMS 키 생성 (동일 KeySpec)
2. 새 키에서 공개키/주소 도출
3. 기존 주소에서 새 주소로 자금 이전
4. 메타데이터 업데이트 (기존 키: disabled, 새 키: active)
5. 기존 키 비활성화 (삭제하지 않음 -- 과거 서명 검증을 위해)

블록체인에서의 키 로테이션은 일반적인 키 로테이션보다 복잡하다:
- 주소 = 공개키(또는 해시)이므로, 키를 바꾸면 주소가 바뀐다
- 주소가 바뀌면 자금 이전이 필요하다
- 외부 시스템에 새 주소를 알려야 한다
```

### EVM과 Solana의 로테이션 차이

```
EVM:
- 주소 = keccak256(pubkey)의 하위 20바이트
- 다른 키면 반드시 다른 주소
- 자금 이전 비용: 가스 수수료

Solana:
- 주소 = 공개키 자체 (32바이트)
- 다른 키면 반드시 다른 주소
- 자금 이전 비용: ~5000 lamports (매우 저렴)

두 체인 모두 키 로테이션 = 주소 변경이다.
로테이션 절차는 동일하게 적용할 수 있다.
```

---

## 멀티 체인 확장 고려

현재는 EVM + Solana 2개 체인이지만, 향후 다른 체인이 추가될 수 있다.
아키텍처를 확장 가능하게 설계한다.

```typescript
// ChainType을 enum으로 관리
type ChainType = 'EVM' | 'SOLANA'; // 향후: | 'COSMOS' | 'APTOS' | 'SUI'

// 체인별 설정을 레지스트리 패턴으로 관리
class ChainRegistry {
  private chains: Map<ChainType, ChainConfig> = new Map();
  
  register(chainType: ChainType, config: ChainConfig): void {
    this.chains.set(chainType, config);
  }
  
  getConfig(chainType: ChainType): ChainConfig {
    const config = this.chains.get(chainType);
    if (!config) throw new Error(`Chain ${chainType} not registered`);
    return config;
  }
}

interface ChainConfig {
  keySpec: string;
  signingAlgorithm: string;
  messageType: 'DIGEST' | 'RAW';
  addressDerivation: AddressDerivation;
  signingConfig: SigningConfig;
  transactionBuilder: TransactionBuilder;
}

// 초기화
const registry = new ChainRegistry();

registry.register('EVM', {
  keySpec: 'ECC_SECG_P256K1',
  signingAlgorithm: 'ECDSA_SHA_256',
  messageType: 'DIGEST',
  addressDerivation: new EvmAddressDerivation(),
  signingConfig: new EvmSigningConfig(),
  transactionBuilder: new EvmTransactionBuilder(),
});

registry.register('SOLANA', {
  keySpec: 'ECC_NIST_EDWARDS25519',
  signingAlgorithm: 'EDDSA_ED25519_SHA_512',
  messageType: 'RAW',
  addressDerivation: new SolanaAddressDerivation(),
  signingConfig: new SolanaSigningConfig(),
  transactionBuilder: new SolanaTransactionBuilder(),
});
```

### 향후 지원 가능한 체인

```
체인별 필요 키 타입:

Ed25519 (KMS 지원):
- Solana     → ECC_NIST_EDWARDS25519
- Aptos      → ECC_NIST_EDWARDS25519 (Ed25519 지원)
- Sui        → ECC_NIST_EDWARDS25519 (Ed25519 지원)
- NEAR       → ECC_NIST_EDWARDS25519
- Cardano    → ECC_NIST_EDWARDS25519

secp256k1 (KMS 지원):
- Ethereum   → ECC_SECG_P256K1
- Bitcoin    → ECC_SECG_P256K1
- Polygon    → ECC_SECG_P256K1
- Arbitrum   → ECC_SECG_P256K1
- (모든 EVM 호환 체인)

기타:
- Cosmos     → secp256k1 (기본) 또는 Ed25519 (선택)
- Polkadot   → Sr25519 (Schnorrkel) → KMS 미지원, 별도 처리 필요

결론: 대부분의 주요 블록체인을 secp256k1 또는 Ed25519로 커버할 수 있다.
```

---

## 정리

```
듀얼 체인 KMS 아키텍처의 핵심:

1. 인프라: 동일한 AWS KMS 인스턴스 하나를 공유한다
2. 키 관리: chain_type 태그로 키를 분류하고 alias로 식별한다
3. 주소 도출: chain_type에 따라 DER 파싱 + 인코딩 로직을 분기한다
4. 서명: chain_type에 따라 Algorithm, MessageType, 전후처리를 분기한다
5. 모니터링: CloudTrail은 자동, CloudWatch 커스텀 메트릭을 추가한다
6. 확장: 레지스트리 패턴으로 새 체인을 쉽게 추가할 수 있게 설계한다

변경 범위가 작고 위험도가 낮다:
- KMS 인프라 변경: 없음
- IAM 정책 변경: 없음
- 네트워크 변경: 없음
- 추가되는 것: 키 생성 시 KeySpec 분기, 서명 시 Algorithm/MessageType 분기, 주소 도출 로직
```

## 참고

- [AWS KMS Key Management Best Practices](https://docs.aws.amazon.com/kms/latest/developerguide/best-practices.html)
- [AWS KMS Quotas](https://docs.aws.amazon.com/kms/latest/developerguide/requests-per-second.html)
- [AWS KMS Tagging](https://docs.aws.amazon.com/kms/latest/developerguide/tagging-keys.html)

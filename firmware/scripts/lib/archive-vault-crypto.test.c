#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include "archive-vault-crypto.h"
int main(void){
 assert(psa_crypto_init()==PSA_SUCCESS);
 psa_key_attributes_t attrs=PSA_KEY_ATTRIBUTES_INIT;psa_key_id_t key;
 unsigned char key_bytes[32]={1,2,3},nonce[12]={4,5,6},aad[8]={'S','C','F','G','D','B','0','1'};
 psa_set_key_type(&attrs,PSA_KEY_TYPE_AES);psa_set_key_bits(&attrs,256);psa_set_key_algorithm(&attrs,PSA_ALG_GCM);psa_set_key_usage_flags(&attrs,PSA_KEY_USAGE_ENCRYPT|PSA_KEY_USAGE_DECRYPT);
 assert(psa_import_key(&attrs,key_bytes,sizeof(key_bytes),&key)==PSA_SUCCESS);
 const size_t lengths[]={0,1,15,16,17,255,256,257,4095,8192,65536};
 for(size_t i=0;i<sizeof(lengths)/sizeof(lengths[0]);i++){
  size_t n=lengths[i],encrypted=0,plain=0;
  unsigned char *input=malloc(n+1),*cipher=malloc(n+16),*decoded=malloc(n+1),*legacy=malloc(n+16);
  for(size_t j=0;j<n;j++)input[j]=(unsigned char)(j*17+3);
  assert(sc_vault_encrypt(key,nonce,aad,8,input,n,cipher,n+16,&encrypted)==PSA_SUCCESS);assert(encrypted==n+16);
  assert(psa_aead_decrypt(key,PSA_ALG_GCM,nonce,12,aad,8,cipher,encrypted,decoded,n,&plain)==PSA_SUCCESS);assert(plain==n&&!memcmp(input,decoded,n));
  assert(psa_aead_encrypt(key,PSA_ALG_GCM,nonce,12,aad,8,input,n,legacy,n+16,&encrypted)==PSA_SUCCESS);
  assert(!memcmp(cipher,legacy,n+16));
  assert(sc_vault_decrypt(key,nonce,aad,8,legacy,encrypted,decoded,n,&plain)==PSA_SUCCESS);assert(plain==n&&!memcmp(input,decoded,n));
  legacy[n+15]^=1;memset(decoded,0x5a,n);
  assert(sc_vault_decrypt(key,nonce,aad,8,legacy,encrypted,decoded,n,&plain)!=PSA_SUCCESS);
  for(size_t j=0;j<n;j++)assert(decoded[j]==0);
  assert(sc_vault_encrypt(key,nonce,aad,8,input,n,cipher,n+15,&encrypted)==PSA_ERROR_BUFFER_TOO_SMALL);
  free(input);free(cipher);free(decoded);free(legacy);
 }
 psa_destroy_key(key);puts("PASS: chunked AES-GCM equals legacy output at 11 sizes through 64KiB; both directions compatible; tampering rejected and plaintext wiped");return 0;
}

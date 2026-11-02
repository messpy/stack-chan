#ifndef STACKCHAN_VAULT_CRYPTO_H
#define STACKCHAN_VAULT_CRYPTO_H
#include <psa/crypto.h>
#include <stdint.h>
#include <string.h>
#define SC_VAULT_CRYPTO_CHUNK 256

// Preserve AES-256-GCM wire format while bounding PSA's temporary copies.
static psa_status_t sc_vault_encrypt(psa_key_id_t key, const uint8_t *nonce,
 const uint8_t *aad, size_t aad_size, const uint8_t *input, size_t size,
 uint8_t *output, size_t capacity, size_t *written)
{
 psa_aead_operation_t op = PSA_AEAD_OPERATION_INIT;
 psa_status_t status;
 size_t offset=0,total=0,count=0,tail_size=0,tag_size=0;
 uint8_t tail[16],tag[16];
 *written=0;
 if(capacity<size+16)return PSA_ERROR_BUFFER_TOO_SMALL;
 status=psa_aead_encrypt_setup(&op,key,PSA_ALG_GCM);
 if(status==PSA_SUCCESS)status=psa_aead_set_lengths(&op,aad_size,size);
 if(status==PSA_SUCCESS)status=psa_aead_set_nonce(&op,nonce,12);
 if(status==PSA_SUCCESS)status=psa_aead_update_ad(&op,aad,aad_size);
 while(status==PSA_SUCCESS&&offset<size){
  size_t use=size-offset;if(use>SC_VAULT_CRYPTO_CHUNK)use=SC_VAULT_CRYPTO_CHUNK;
  size_t available=capacity-total;if(available>use+16)available=use+16;
  status=psa_aead_update(&op,input+offset,use,output+total,available,&count);
  offset+=use;total+=count;
 }
 if(status==PSA_SUCCESS)status=psa_aead_finish(&op,tail,sizeof(tail),&tail_size,tag,sizeof(tag),&tag_size);
 if(status==PSA_SUCCESS&&(total+tail_size!=size||tag_size!=16))status=PSA_ERROR_GENERIC_ERROR;
 if(status==PSA_SUCCESS){memcpy(output+total,tail,tail_size);total+=tail_size;memcpy(output+total,tag,16);*written=total+16;}
 else memset(output,0,capacity);
 psa_aead_abort(&op);memset(tail,0,sizeof(tail));memset(tag,0,sizeof(tag));
 return status;
}

static psa_status_t sc_vault_decrypt(psa_key_id_t key, const uint8_t *nonce,
 const uint8_t *aad, size_t aad_size, const uint8_t *input, size_t size,
 uint8_t *output, size_t capacity, size_t *written)
{
 psa_aead_operation_t op = PSA_AEAD_OPERATION_INIT;
 psa_status_t status;
 size_t offset=0,total=0,count=0,tail_size=0;
 uint8_t tail[16];
 *written=0;
 if(size<16)return PSA_ERROR_INVALID_ARGUMENT;
 size_t plain_size=size-16;
 if(capacity<plain_size)return PSA_ERROR_BUFFER_TOO_SMALL;
 status=psa_aead_decrypt_setup(&op,key,PSA_ALG_GCM);
 if(status==PSA_SUCCESS)status=psa_aead_set_lengths(&op,aad_size,plain_size);
 if(status==PSA_SUCCESS)status=psa_aead_set_nonce(&op,nonce,12);
 if(status==PSA_SUCCESS)status=psa_aead_update_ad(&op,aad,aad_size);
 while(status==PSA_SUCCESS&&offset<plain_size){
  size_t use=plain_size-offset;if(use>SC_VAULT_CRYPTO_CHUNK)use=SC_VAULT_CRYPTO_CHUNK;
  size_t available=capacity-total;if(available>use+16)available=use+16;
  status=psa_aead_update(&op,input+offset,use,output+total,available,&count);
  offset+=use;total+=count;
 }
 if(status==PSA_SUCCESS)status=psa_aead_verify(&op,tail,sizeof(tail),&tail_size,input+plain_size,16);
 if(status==PSA_SUCCESS&&total+tail_size!=plain_size)status=PSA_ERROR_GENERIC_ERROR;
 if(status==PSA_SUCCESS){memcpy(output+total,tail,tail_size);*written=total+tail_size;}
 else memset(output,0,capacity);
 psa_aead_abort(&op);memset(tail,0,sizeof(tail));
 return status;
}
#endif

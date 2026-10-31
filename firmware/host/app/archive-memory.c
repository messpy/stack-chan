// SQLite release assertions must be selected before ESP-IDF assert.h (pragma once).
#define NDEBUG 1
#include "xsmc.h"
#include "mc.defines.h"
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <errno.h>
#include "esp_heap_caps.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#define SQLITE_OS_OTHER 1
#define SQLITE_THREADSAFE 0
#define SQLITE_OMIT_LOAD_EXTENSION 1
#define SQLITE_OMIT_WAL 1
#define SQLITE_OMIT_DEPRECATED 1
#define SQLITE_DEFAULT_MEMSTATUS 0
#define SQLITE_TEMP_STORE 3
#define SQLITE_DEFAULT_CACHE_SIZE -128
#define SQLITE_DEFAULT_PAGE_SIZE 1024
#define SQLITE_MAX_LENGTH 262144
#define SQLITE_MAX_SQL_LENGTH 32768
#define SQLITE_MAX_VARIABLE_NUMBER 128
#include "../../vendor/sqlite/sqlite3.c"

typedef struct {sqlite3_file base;int fd;int remove;char path[192];} ArchiveFile;
static int afClose(sqlite3_file *f){ArchiveFile*a=(ArchiveFile*)f;int r=close(a->fd);if(a->remove)unlink(a->path);return r?SQLITE_IOERR_CLOSE:SQLITE_OK;}
static int afRead(sqlite3_file*f,void*buf,int count,sqlite3_int64 at){
 ArchiveFile*a=(ArchiveFile*)f;struct stat info;if(fstat(a->fd,&info))return SQLITE_IOERR_FSTAT;
 // FatFS f_lseek on a writable file extends it. Reads past EOF must not seek.
 if(at>=info.st_size){memset(buf,0,count);return SQLITE_IOERR_SHORT_READ;}
 int available=(int)((sqlite3_int64)count<info.st_size-at?count:info.st_size-at);
 if(lseek(a->fd,at,SEEK_SET)<0)return SQLITE_IOERR_SEEK;
 int done=0;while(done<available){int n=read(a->fd,(char*)buf+done,available-done);if(n<0){if(errno==EINTR)continue;return SQLITE_IOERR_READ;}if(!n)break;done+=n;}
 if(done<count){memset((char*)buf+done,0,count-done);return SQLITE_IOERR_SHORT_READ;}return SQLITE_OK;
}
static int afWrite(sqlite3_file*f,const void*buf,int count,sqlite3_int64 at){ArchiveFile*a=(ArchiveFile*)f;if(lseek(a->fd,at,SEEK_SET)<0)return SQLITE_IOERR_SEEK;int done=0;while(done<count){int n=write(a->fd,(const char*)buf+done,count-done);if(n<=0){if(n<0&&errno==EINTR)continue;return SQLITE_IOERR_WRITE;}done+=n;}return SQLITE_OK;}
static int afTruncate(sqlite3_file*f,sqlite3_int64 size){return ftruncate(((ArchiveFile*)f)->fd,size)?SQLITE_IOERR_TRUNCATE:SQLITE_OK;}
static int afSync(sqlite3_file*f,int flags){(void)flags;return fsync(((ArchiveFile*)f)->fd)?SQLITE_IOERR_FSYNC:SQLITE_OK;}
static int afSize(sqlite3_file*f,sqlite3_int64*out){struct stat s;if(fstat(((ArchiveFile*)f)->fd,&s))return SQLITE_IOERR_FSTAT;*out=s.st_size;return SQLITE_OK;}
// Only the main XS machine owns this database connection; no cross-process writers.
static int afLock(sqlite3_file*f,int n){(void)f;(void)n;return SQLITE_OK;}
static int afUnlock(sqlite3_file*f,int n){(void)f;(void)n;return SQLITE_OK;}
static int afReserved(sqlite3_file*f,int*out){(void)f;*out=0;return SQLITE_OK;}
static int afControl(sqlite3_file*f,int n,void*p){(void)f;(void)n;(void)p;return SQLITE_NOTFOUND;}
static int afSector(sqlite3_file*f){(void)f;return 512;}
static int afDevice(sqlite3_file*f){(void)f;return 0;}
static const sqlite3_io_methods methods={.iVersion=1,.xClose=afClose,.xRead=afRead,.xWrite=afWrite,.xTruncate=afTruncate,.xSync=afSync,.xFileSize=afSize,.xLock=afLock,.xUnlock=afUnlock,.xCheckReservedLock=afReserved,.xFileControl=afControl,.xSectorSize=afSector,.xDeviceCharacteristics=afDevice};
static int avOpen(sqlite3_vfs*v,const char*name,sqlite3_file*f,int flags,int*out){(void)v;ArchiveFile*a=(ArchiveFile*)f;memset(a,0,sizeof(*a));if(!name){unsigned r=esp_random();snprintf(a->path,sizeof(a->path),MODDEF_FILE_ROOT "/stackchan/sqlite-temp-%08x",r);a->remove=1;}else{if(strlen(name)>=sizeof(a->path))return SQLITE_CANTOPEN;strcpy(a->path,name);}int mode=(flags&SQLITE_OPEN_READWRITE)?O_RDWR:O_RDONLY;if(flags&SQLITE_OPEN_CREATE)mode|=O_CREAT;if(flags&SQLITE_OPEN_EXCLUSIVE)mode|=O_EXCL;a->remove|=(flags&SQLITE_OPEN_DELETEONCLOSE)!=0;a->fd=open(a->path,mode,0600);if(a->fd<0)return SQLITE_CANTOPEN;a->base.pMethods=&methods;if(out)*out=flags;return SQLITE_OK;}
static int avDelete(sqlite3_vfs*v,const char*path,int sync){(void)v;(void)sync;return !unlink(path)||errno==ENOENT?SQLITE_OK:SQLITE_IOERR_DELETE;}
static int avAccess(sqlite3_vfs*v,const char*path,int flags,int*out){(void)v;(void)flags;struct stat s;*out=!stat(path,&s);return SQLITE_OK;}
static int avFull(sqlite3_vfs*v,const char*path,int count,char*out){(void)v;int n=snprintf(out,count,"%s",path);return n<0||n>=count?SQLITE_CANTOPEN:SQLITE_OK;}
static int avRandom(sqlite3_vfs*v,int count,char*out){(void)v;esp_fill_random(out,count);return count;}
static int avSleep(sqlite3_vfs*v,int us){(void)v;vTaskDelay(pdMS_TO_TICKS((us+999)/1000)+1);return us;}
static int avTime(sqlite3_vfs*v,double*out){(void)v;struct timeval tv;gettimeofday(&tv,NULL);*out=2440587.5+((double)tv.tv_sec+tv.tv_usec/1000000.0)/86400.0;return SQLITE_OK;}
static int avError(sqlite3_vfs*v,int n,char*out){(void)v;if(n)out[0]=0;return errno;}
static sqlite3_vfs vfs={.iVersion=1,.szOsFile=sizeof(ArchiveFile),.mxPathname=192,.zName="stackchan-sd",.xOpen=avOpen,.xDelete=avDelete,.xAccess=avAccess,.xFullPathname=avFull,.xRandomness=avRandom,.xSleep=avSleep,.xCurrentTime=avTime,.xGetLastError=avError};
int sqlite3_os_init(void){return sqlite3_vfs_register(&vfs,1);}
int sqlite3_os_end(void){return SQLITE_OK;}
static void* dbMalloc(int n){void*p=heap_caps_malloc(n,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);return p?p:heap_caps_malloc(n,MALLOC_CAP_8BIT);}
static void dbFree(void*p){heap_caps_free(p);}
static void* dbRealloc(void*p,int n){return heap_caps_realloc(p,n,MALLOC_CAP_8BIT);}
static int dbSize(void*p){return (int)heap_caps_get_allocated_size(p);}
static int dbRound(int n){return (n+7)&~7;}
static int dbInit(void*p){(void)p;return SQLITE_OK;}
static void dbShutdown(void*p){(void)p;}
static sqlite3* db;
void xs_archive_database(xsMachine*the){
 xsmcVars(4);
 if(!db){sqlite3_mem_methods memory={dbMalloc,dbFree,dbRealloc,dbSize,dbRound,dbInit,dbShutdown,NULL};sqlite3_config(SQLITE_CONFIG_MALLOC,&memory);int rc=sqlite3_open_v2(MODDEF_FILE_ROOT "/stackchan/memory.sqlite3",&db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE,"stackchan-sd");if(rc!=SQLITE_OK){if(db)sqlite3_close(db);db=NULL;xsUnknownError("SD database open failed (%d)",rc);}sqlite3_busy_timeout(db,2000);}
 sqlite3_stmt*statement=NULL;int rc=sqlite3_prepare_v2(db,xsmcToString(xsArg(0)),-1,&statement,NULL);if(rc!=SQLITE_OK)xsUnknownError("SD database prepare failed (%d)",rc);
 if(xsmcArgc>1){xsmcGet(xsVar(3),xsArg(1),xsID("length"));int length=xsmcToInteger(xsVar(3));for(int i=0;i<length;i++){xsmcGetIndex(xsVar(0),xsArg(1),i);int type=xsmcTypeOf(xsVar(0));if(type==xsStringType)rc=sqlite3_bind_text(statement,i+1,xsmcToString(xsVar(0)),-1,SQLITE_TRANSIENT);else if(type==xsNumberType||type==xsIntegerType)rc=sqlite3_bind_double(statement,i+1,xsmcToNumber(xsVar(0)));else if(type==xsBooleanType)rc=sqlite3_bind_int(statement,i+1,xsmcToBoolean(xsVar(0)));else rc=sqlite3_bind_null(statement,i+1);if(rc!=SQLITE_OK){sqlite3_finalize(statement);xsUnknownError("SD database bind failed (%d)",rc);}}}
 xsResult=xsNewArray(0);unsigned rows=0;
 while((rc=sqlite3_step(statement))==SQLITE_ROW){if(rows>=200){sqlite3_finalize(statement);xsUnknownError("SD database result limit exceeded");}xsmcSetNewObject(xsVar(1));for(int i=0;i<sqlite3_column_count(statement);i++){int kind=sqlite3_column_type(statement,i);if(kind==SQLITE_NULL)xsVar(2)=xsNull;else if(kind==SQLITE_INTEGER||kind==SQLITE_FLOAT)xsmcSetNumber(xsVar(2),sqlite3_column_double(statement,i));else xsmcSetString(xsVar(2),(char*)sqlite3_column_text(statement,i));xsmcSet(xsVar(1),xsID(sqlite3_column_name(statement,i)),xsVar(2));}xsmcSetIndex(xsResult,rows++,xsVar(1));}
 sqlite3_finalize(statement);if(rc!=SQLITE_DONE)xsUnknownError("SD database execution failed (%d)",rc);
}

void xs_archive_database_close(xsMachine*the){(void)the;if(db){int rc=sqlite3_close(db);if(rc!=SQLITE_OK)xsUnknownError("SD database close failed (%d)",rc);db=NULL;}sqlite3_shutdown();}

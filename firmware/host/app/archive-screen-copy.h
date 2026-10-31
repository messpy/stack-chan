#include <string.h>
static void sc_screen_copy(unsigned char *dst,int width,int height,int x,int y,int w,int h,int *cursor,const unsigned char *src,int bytes){
    if(w<=0||h<=0)return;
    int remaining=bytes/2;
    while(remaining>0){
        int row=*cursor/w,col=*cursor%w,n=w-col;if(n>remaining)n=remaining;
        int dx=x+col,dy=y+row,start=dx<0?-dx:0,end=n;
        if(dx+end>width)end=width-dx;
        if(row<h&&dy>=0&&dy<height&&end>start)memcpy(dst+(dy*width+dx+start)*2,src+start*2,(end-start)*2);
        *cursor+=n;remaining-=n;src+=n*2;
    }
}

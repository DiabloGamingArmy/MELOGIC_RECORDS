export const PAPER_SIZES = { A4:[794,1123],Letter:[816,1056] }
/** Pure layout: page/system/measure rectangles, independent of SVG and playback. */
export function layoutScore(model, input={}) {
  const config={type:'continuous',paper:'A4',orientation:'portrait',margin:48,systemSpacing:44,pageSpacing:24,breaks:[],...input}
  const cells=[],systems=[],pages=[]
  const height=model.height||270,labelWidth=96
  if(config.type!=='page') {
    let x=labelWidth
    for(const measure of model.measures){cells.push({id:String(measure.index),measure,system:0,page:0,x,y:0,width:measure.width,height,scale:1});x+=measure.width}
    systems.push({index:0,page:0,x:0,y:0,width:x,height,scale:1})
    return {cells,systems,pages,width:x+24,height}
  }
  let [pageWidth,pageHeight]=PAPER_SIZES[config.paper]||PAPER_SIZES.A4
  if(config.orientation==='landscape')[pageWidth,pageHeight]=[pageHeight,pageWidth]
  const margin=Math.max(16,Math.min(120,Number(config.margin)||48)),gap=Math.max(10,Number(config.systemSpacing)||44),pageGap=Math.max(0,Number(config.pageSpacing)||24)
  const available=pageWidth-margin*2-labelWidth,scale=Math.min(1,(pageHeight-margin*2-130)/height)
  let page=0,y=margin+100,row=[]
  const makePage=()=>pages.push({index:page,x:0,y:page*(pageHeight+pageGap),width:pageWidth,height:pageHeight})
  makePage()
  const nextPage=()=>{page++;y=margin+35;makePage()}
  const flush=()=>{
    if(!row.length)return
    const systemHeight=height*scale
    if(y+systemHeight>pageHeight-margin)nextPage()
    const system=systems.length,systemY=page*(pageHeight+pageGap)+y
    const total=row.reduce((sum,m)=>sum+m.width,0)
    let x=margin+labelWidth
    for(const measure of row){const width=available/scale*measure.width/total;cells.push({id:String(measure.index),measure,system,page,x,y:systemY,width,height,scale});x+=width*scale}
    systems.push({index:system,page,x:margin,y:systemY,width:pageWidth-margin*2,height:systemHeight,scale})
    y+=systemHeight+gap;row=[]
  }
  for(const measure of model.measures){
    const manual=config.breaks.find(b=>b.measure===measure.index)
    if(manual){flush();if(manual.type==='page'&&y>margin+35)nextPage()}
    if(row.length&&(row.reduce((sum,m)=>sum+m.width,0)+measure.width)*scale>available)flush()
    row.push(measure)
  }
  flush()
  return {cells,systems,pages,width:pageWidth,height:pages.length*(pageHeight+pageGap)-pageGap,pageWidth,pageHeight}
}
export function visibleLayoutCells(layout,{left,top,width,height,zoom=1},overscan=250) {
  const x=left/zoom,y=top/zoom,w=width/zoom,h=height/zoom
  return layout.cells.filter(c=>c.x+c.width*c.scale>=x-overscan&&c.x<=x+w+overscan&&c.y+c.height*c.scale>=y-overscan&&c.y<=y+h+overscan)
}

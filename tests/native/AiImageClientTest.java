package com.qingyan.editor;
import javax.net.ssl.*;
import java.io.*;
import java.net.URL;
import java.security.Principal;
import java.security.cert.Certificate;
import java.nio.file.*;
import java.util.Base64;
public final class AiImageClientTest {
 static int checks;
 static void check(boolean v,String message){checks++;if(!v)throw new AssertionError(message);}
 static void rejects(Throwing action)throws Exception{checks++;try{action.run();throw new AssertionError("Expected rejection");}catch(IOException expected){}}
 interface Throwing{void run()throws Exception;}
 static final class Fake extends HttpsURLConnection {
  final ByteArrayOutputStream sent=new ByteArrayOutputStream(); byte[] response="{\"data\":[]}".getBytes();int status=200;boolean disconnected;
  Fake()throws Exception{super(new URL("https://example.invalid/images/edits"));}
  public void connect(){}public void disconnect(){disconnected=true;}public boolean usingProxy(){return false;}
  public OutputStream getOutputStream(){return sent;}public int getResponseCode(){return status;}public InputStream getInputStream(){return new ByteArrayInputStream(response);}
  public String getCipherSuite(){return "MOCK";}public Certificate[] getLocalCertificates(){return null;}public Certificate[] getServerCertificates(){return null;}public Principal getPeerPrincipal(){return null;}public Principal getLocalPrincipal(){return null;}
 }
 public static void main(String[] args)throws Exception{
  byte[] png=Files.readAllBytes(Path.of(args[0]));String data="data:image/png;base64,"+Base64.getEncoder().encodeToString(png);
  AiImageClient.Request request=new AiImageClient.Request("https://example.invalid/images/edits","mock-only-key","model","只删除选区",data,data);
  Fake f=new Fake();AiImageClient client=new AiImageClient(url->f);String result=client.edit(request);
  String body=f.sent.toString("UTF-8");check(body.contains("name=\"mask\"; filename=\"mint-mask.png\""),"actual mask file");check(body.contains("只删除选区"),"UTF8 prompt");check(body.contains("name=\"output_format\"\r\n\r\npng"),"PNG output");check("Bearer mock-only-key".equals(f.getRequestProperty("Authorization")),"auth");check(!f.getInstanceFollowRedirects()&&!f.getUseCaches(),"no redirects/cache");check(f.disconnected&&result.contains("data"),"bounded response and close");
  for(String url:new String[]{"http://example.invalid/edit","https://key@example.invalid/edit","https://example.invalid/edit?key=secret","https://example.invalid/edit#x"})rejects(()->new AiImageClient.Request(url,"key","model","prompt",data,null));
  rejects(()->new AiImageClient.Request("https://example.invalid/edit","key\r\nInjected:1","model","prompt",data,null));
  byte[] wrong=png.clone();wrong[19]^=1;rejects(()->new AiImageClient.Request("https://example.invalid/edit","key","model","prompt",data,"data:image/png;base64,"+Base64.getEncoder().encodeToString(wrong)));
  Fake redirect=new Fake();redirect.status=302;rejects(()->new AiImageClient(url->redirect).edit(request));check(redirect.sent.size()>0&&redirect.disconnected,"redirect refused and closed");
  AiImageClient cancelled=new AiImageClient(url->{throw new AssertionError("cancelled opened network");});cancelled.cancel();rejects(()->cancelled.edit(request));
  Fake oversized=new Fake();oversized.response=new byte[24*1024*1024+1];rejects(()->new AiImageClient(url->oversized).edit(request));
  byte[] huge=png.clone();huge[16]=1;rejects(()->AiImageClient.validatePng(huge));
  System.out.println("Native AI mock transport: "+checks+" checks passed; no live service or Android runtime tested.");
 }
}

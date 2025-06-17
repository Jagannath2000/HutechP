public class Day_3_q1 {
    
    public static void main(String[] args) {
        String s1= "hello";
        String s2 = "hello";
        String s3 = new String("hello");
        System.out.println(s1==s2); //f
        System.out.println(s2==s3);//f
        System.out.println(s3.equals(s1));//T
    }
}

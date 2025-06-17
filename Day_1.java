import java.util.Scanner;

public class Day_1 {
    //Armstrong Number
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println("Enter Number");
        int num = sc.nextInt();
        if(isAramstrong(num)){
            System.out.println(num + " is a Aramstrong number ");
        }
        else{
            System.out.println(num +" Is not a aramstrong number");
        }

        
    }

    private static boolean isAramstrong(int num) {
        int add = 0;
        int b = num;
        while (num>0) {
            int c=num%10;
            add = add+queue(c);
            num = num/10;
            
        }
        
        return b==add;
    }

    private static int queue(int num) {
        int q = num*num*num;
        return q;
    }
    
}

package Hutech;

import java.util.Scanner;

public class Day_2_q2 {
    //Write a Program to Swap Two Numbers
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println("Enter 2 numbers :");
        int a= sc.nextInt();
        int b = sc.nextInt();

        a=a^b;
        b=a^b;
        a = a^b;
        
        System.out.println(a+" "+b);

        
    }
    
}
